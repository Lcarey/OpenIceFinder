# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2", "pandas>=2.2", "scikit-learn>=1.5", "xgboost>=2.1", "lightgbm>=4.5"]
# ///
"""Walk-forward machine-learning sweep over the backtest's feature table.

Every column in data/backtest/features.csv is itself computed only from games on earlier dates, and each model
here is refit before every game date using only rows from earlier dates. Ties are half a win (soft labels).

Usage: uv run scripts/belief_ml.py            (npm run backtest:belief first)
Writes data/backtest/ml-results.json
"""
import json, math, time, warnings
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parent.parent
df = pd.read_csv(ROOT / "data" / "backtest" / "features.csv")
meta = ["game", "date", "birth_year", "home", "away", "y", "prior_home", "prior_away", "split",
        "prior_home_e9", "prior_away_e9", "prior_home_mhr", "prior_away_mhr"]
signals = [c for c in df.columns if c not in meta]

# Prior features as home-minus-away with missing as 0 plus availability flags.
for src in ["e9", "mhr"]:
    h, a = df[f"prior_home_{src}"], df[f"prior_away_{src}"]
    df[f"prior_diff_{src}"] = h.fillna(0) - a.fillna(0)
    df[f"prior_both_{src}"] = (h.notna() & a.notna()).astype(float)
df["min_games"] = np.minimum(df.prior_home, df.prior_away)
df["age"] = 2026 - df.birth_year
extra = ["prior_diff_e9", "prior_both_e9", "prior_diff_mhr", "prior_both_mhr", "min_games", "age"]

CURATED = ["massey:cap8:l1", "massey+prior:blend:rho0.25:l1", "poisson:l3", "elo:k48:hfa35:log", "bt:l0.3:soft4", "colley",
           "record:points-pct", "record:gd:capInfinity", "record:gf-per-game", "record:ga-per-game", "form:points-pct:last5",
           "form:gd:cap5:last5", "form:streak", "form:last-result", "form:residual:last5", "h2h:margin", "h2h:result", "rest-days",
           "sos:opp-points-pct", "kalman:q0.002:r9:v3"]
FEATURE_SETS = {"curated+context": [c for c in CURATED if c in df.columns] + extra, "all signals+context": signals + extra}

y = df.y.to_numpy()
dates = df.date.to_numpy()
calib_ok = (df.prior_home >= 2) & (df.prior_away >= 2)


def soft_to_weighted(X, yv):
    """Duplicate rows so a tie is half a win and half a loss, for learners that need hard labels."""
    win = yv >= 0.75
    loss = yv <= 0.25
    tie = ~(win | loss)
    Xw = np.vstack([X[win], X[loss], X[tie], X[tie]])
    yw = np.concatenate([np.ones(win.sum()), np.zeros(loss.sum()), np.ones(tie.sum()), np.zeros(tie.sum())])
    w = np.concatenate([np.ones(win.sum() + loss.sum()), np.full(2 * tie.sum(), 0.5)])
    return Xw, yw, w


def make_models():
    return {
        "logistic L2 C=0.1": lambda: ("hard", make_pipeline(StandardScaler(), LogisticRegression(C=0.1, max_iter=2000))),
        "logistic L2 C=0.01": lambda: ("hard", make_pipeline(StandardScaler(), LogisticRegression(C=0.01, max_iter=2000))),
        "XGBoost depth2 300": lambda: ("soft", xgb.XGBRegressor(objective="reg:logistic", n_estimators=300, max_depth=2, learning_rate=0.03, subsample=0.8, colsample_bytree=0.5, min_child_weight=5, reg_lambda=5, n_jobs=4)),
        "XGBoost depth3 500": lambda: ("soft", xgb.XGBRegressor(objective="reg:logistic", n_estimators=500, max_depth=3, learning_rate=0.02, subsample=0.8, colsample_bytree=0.5, min_child_weight=10, reg_lambda=10, n_jobs=4)),
        "LightGBM 31 leaves": lambda: ("soft", lgb.LGBMRegressor(objective="cross_entropy", n_estimators=400, learning_rate=0.02, num_leaves=31, min_child_samples=30, subsample=0.8, subsample_freq=1, colsample_bytree=0.5, reg_lambda=5, verbose=-1)),
        "LightGBM 7 leaves": lambda: ("soft", lgb.LGBMRegressor(objective="cross_entropy", n_estimators=400, learning_rate=0.03, num_leaves=7, min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.5, reg_lambda=5, verbose=-1)),
        "random forest 300": lambda: ("reg", RandomForestRegressor(n_estimators=300, min_samples_leaf=20, max_features=0.3, n_jobs=4, random_state=0)),
        "MLP 16x8": lambda: ("reg", make_pipeline(StandardScaler(), MLPRegressor(hidden_layer_sizes=(16, 8), alpha=1.0, max_iter=800, early_stopping=False, random_state=0))),
    }


def walk_forward(feats, build, refit_every=3):
    X = df[feats].fillna(0).to_numpy(dtype=float)
    p = np.full(len(df), np.nan)
    uniq = sorted(set(dates))
    model = None
    kind = None
    for k, d in enumerate(uniq):
        past = (dates < d) & calib_ok.to_numpy()
        today = dates == d
        if past.sum() < 200:
            continue
        if model is None or k % refit_every == 0:
            kind, model = build()
            Xp, yp = X[past], y[past]
            if kind == "soft":
                model.fit(Xp, yp)
            elif kind == "hard":
                Xw, yw, w = soft_to_weighted(Xp, yp)
                model.fit(Xw, yw, logisticregression__sample_weight=w)
            else:
                model.fit(Xp, yp)
        if kind == "hard":
            p[today] = model.predict_proba(X[today])[:, 1]
        else:
            p[today] = model.predict(X[today])
    return np.clip(p, 1e-4, 1 - 1e-4)


def score(p, mask):
    m = mask & ~np.isnan(p)
    pv, yv = p[m], y[m]
    acc = np.where(yv == 0.5, 0.5, np.where((pv > 0.5) == (yv == 1), 1.0, 0.0)).mean()
    ll = -(yv * np.log(pv) + (1 - yv) * np.log(1 - pv)).mean()
    return {"n": int(m.sum()), "accuracy": float(acc), "logLoss": float(ll)}


train = (df.split == "train").to_numpy()
hold = (df.split == "holdout").to_numpy()
elig = train | hold
early = (df.split == "early").to_numpy()
results = []
for fs_name, feats in FEATURE_SETS.items():
    for name, build in make_models().items():
        t = time.time()
        p = walk_forward(feats, build)
        r = {"model": name, "features": fs_name, "nFeatures": len(feats), "train": score(p, train), "holdout": score(p, hold), "eligible": score(p, elig), "early": score(p, early), "seconds": round(time.time() - t, 1)}
        results.append(r)
        print(f"{name:22} {fs_name:20} train {100*r['train']['accuracy']:.1f}% {r['train']['logLoss']:.4f}  hold {100*r['holdout']['accuracy']:.1f}% {r['holdout']['logLoss']:.4f}  early {100*r['early']['accuracy']:.1f}%  ({r['seconds']}s)", flush=True)

# Reference: the shipped single rating, scored the same way.
res = json.loads((ROOT / "data" / "backtest" / "results.json").read_text())
ref = next(r for r in res["results"] if r["name"] == "massey:cap8:l1")
out = {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "reference": {"name": ref["name"], "train": ref["train"], "holdout": ref["holdout"], "eligible": ref["all"]}, "results": results}
(ROOT / "data" / "backtest" / "ml-results.json").write_text(json.dumps(out, indent=1) + "\n")
print(f"reference massey:cap8:l1  train {100*ref['train']['accuracy']:.1f}% {ref['train']['logLoss']:.4f}  hold {100*ref['holdout']['accuracy']:.1f}% {ref['holdout']['logLoss']:.4f}")
