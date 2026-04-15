#!/usr/bin/env python3
"""
Generate publication-quality PNG figures from RazorCascade experiment data.

Usage:
    python generate_paper_figures.py <data_folder>

Example:
    python generate_paper_figures.py data/2026-03-25T02-27-04-568Z

Output (saved to <data_folder>/):
    fig_cost_comparison.png       — Mean cost per config with 95 % CI error bars
    fig_quality_comparison.png    — Mean quality per config with 95 % CI error bars
    fig_tokens_comparison.png     — Mean total tokens per config with 95 % CI error bars
    fig_drift_comparison.png      — Mean drift score per config (cascade configs only)
    fig_iteration_cost.png        — Per-step mean cost curves across iterations
    fig_iteration_drift.png       — Per-step mean drift score curves across iterations
    fig_cost_quality_tradeoff.png — Cost vs quality scatter with CI/stddev error bars
    fig_cost_distribution.png     — Box plots of per-run cost distributions

Requirements:
    pip install matplotlib numpy
"""

import argparse
import csv
import json
import os
import sys
from collections import defaultdict

import numpy as np

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

# ── Typography & layout ─────────────────────────────────────────────────────

DPI         = 300
FONT_FAMILY = "sans-serif"
FONT_BASE   = 9    # pt  – body / axis labels
FONT_TITLE  = 10   # pt  – subplot titles
FONT_TICK   = 8    # pt  – tick labels
FONT_LEGEND = 7.5  # pt  – legend entries
FONT_ANNOT  = 6.5  # pt  – value annotations on bars

# IEEE two-column widths (inches)
COL1 = 3.5   # single column
COL2 = 7.2   # full page width / double column


def apply_style() -> None:
    plt.rcParams.update({
        "font.family":           FONT_FAMILY,
        "font.size":             FONT_BASE,
        "axes.titlesize":        FONT_TITLE,
        "axes.labelsize":        FONT_BASE,
        "xtick.labelsize":       FONT_TICK,
        "ytick.labelsize":       FONT_TICK,
        "legend.fontsize":       FONT_LEGEND,
        "legend.framealpha":     0.9,
        "legend.edgecolor":      "#cccccc",
        "legend.borderpad":      0.4,
        "figure.dpi":            DPI,
        "savefig.dpi":           DPI,
        "savefig.bbox":          "tight",
        "savefig.pad_inches":    0.04,
        "axes.spines.top":       False,
        "axes.spines.right":     False,
        "axes.linewidth":        0.6,
        "xtick.major.width":     0.6,
        "ytick.major.width":     0.6,
        "grid.alpha":            0.25,
        "grid.linestyle":        "--",
        "grid.linewidth":        0.5,
        "axes.grid":             True,
    })


# ── Palette & per-config metadata ────────────────────────────────────────────
#
# Colors are chosen from a colorblind-accessible Tableau-derived set.
# Baselines use darker, fully saturated hues; cascade variants use lighter
# tints of the same hue family.  Hatching distinguishes modes in greyscale
# print as well.

CONFIG_META: dict[str, dict] = {
    "baseline-openai": {"provider": "openai",  "mode": "baseline",
                        "color": "#1B4E8A", "hatch": "",    "marker": "o",  "ls": "-"},
    "openai-mini":     {"provider": "openai",  "mode": "cascade",
                        "color": "#5B9BD5", "hatch": "///", "marker": "s",  "ls": "--"},
    "openai-nano":     {"provider": "openai",  "mode": "cascade",
                        "color": "#A8C8E8", "hatch": "xxx", "marker": "^",  "ls": ":"},
    "baseline-grok":   {"provider": "xai",     "mode": "baseline",
                        "color": "#1A6B3C", "hatch": "",    "marker": "o",  "ls": "-"},
    "grok":            {"provider": "xai",     "mode": "cascade",
                        "color": "#4CAF75", "hatch": "///", "marker": "s",  "ls": "--"},
    "baseline-gemini": {"provider": "gemini",  "mode": "baseline",
                        "color": "#8B1A1A", "hatch": "",    "marker": "o",  "ls": "-"},
    "gemini":          {"provider": "gemini",  "mode": "cascade",
                        "color": "#D96B6B", "hatch": "///", "marker": "s",  "ls": "--"},
}

# Display order used across all bar charts
DISPLAY_ORDER = [
    "baseline-openai", "openai-mini", "openai-nano",
    "baseline-grok",   "grok",
    "baseline-gemini", "gemini",
]


# ── Data loading ─────────────────────────────────────────────────────────────

def load_summary(folder: str) -> dict:
    path = os.path.join(folder, "summary.json")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_csv(folder: str, filename: str) -> list[dict]:
    path = os.path.join(folder, filename)
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


# ── Save helper ──────────────────────────────────────────────────────────────

def save(fig: plt.Figure, folder: str, name: str) -> None:
    path = os.path.join(folder, name)
    fig.savefig(path, dpi=DPI, bbox_inches="tight", pad_inches=0.04)
    plt.close(fig)
    print(f"  Saved: {path}")


# ── Significance annotation helper ───────────────────────────────────────────

def sig_stars(p: float | None) -> str:
    """Return significance stars for a p-value (Bonferroni-corrected)."""
    if p is None:
        return ""
    if p < 0.001:
        return "***"
    if p < 0.01:
        return "**"
    if p < 0.05:
        return "*"
    return "ns"


# ── Figure 1: Mean Cost comparison ───────────────────────────────────────────

def fig_cost_comparison(summary: dict, folder: str) -> None:
    by_name = {c["config"]: c for c in summary["configs"]}
    ordered = [by_name[k] for k in DISPLAY_ORDER if k in by_name]

    labels = [c["config"] for c in ordered]
    means  = np.array([c["mean_cost_usd"] for c in ordered])
    ci_lo  = np.array([c["mean_cost_usd"] - c["ci95_cost_lower"] for c in ordered])
    ci_hi  = np.array([c["ci95_cost_upper"] - c["mean_cost_usd"] for c in ordered])
    colors = [CONFIG_META.get(l, {}).get("color", "#888888") for l in labels]
    stars  = [sig_stars(c.get("pValue_cost_corrected")) for c in ordered]

    fig, ax = plt.subplots(figsize=(COL2, 2.9))

    y = np.arange(len(labels))
    bars = ax.barh(
        y, means,
        xerr=[ci_lo, ci_hi],
        color=colors, height=0.55, capsize=3,
        error_kw={"linewidth": 0.8, "ecolor": "#333333", "capthick": 0.8},
        zorder=3,
    )

    for bar, label in zip(bars, labels):
        hatch = CONFIG_META.get(label, {}).get("hatch", "")
        if hatch:
            bar.set_hatch(hatch)
            bar.set_edgecolor("white")
        else:
            bar.set_edgecolor("none")

    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    ax.invert_yaxis()
    ax.set_xlabel("Mean Total Cost (USD)")
    ax.set_title("Mean Cost per Configuration with 95% CI", pad=5)
    ax.grid(axis="x")
    ax.grid(False, axis="y")
    ax.set_axisbelow(True)

    # Value + significance annotations
    x_max = float((means + ci_hi).max())
    for i, (mv, bar, star) in enumerate(zip(means, bars, stars)):
        label_str = f"${mv:.4f}"
        if star and star != "ns":
            label_str += f"  {star}"
        ax.text(
            x_max * 1.01, bar.get_y() + bar.get_height() / 2,
            label_str, va="center", ha="left", fontsize=FONT_ANNOT,
        )

    ax.set_xlim(right=x_max * 1.18)

    # Legend
    bline  = mpatches.Patch(facecolor="#666666", label="Baseline")
    casc   = mpatches.Patch(facecolor="#aaaaaa", hatch="///", edgecolor="white", label="Cascade")
    ax.legend(handles=[bline, casc], loc="lower right", fontsize=FONT_LEGEND)

    save(fig, folder, "fig_cost_comparison.png")


# ── Figure 2: Mean Quality comparison ────────────────────────────────────────

def fig_quality_comparison(summary: dict, folder: str) -> None:
    by_name = {c["config"]: c for c in summary["configs"]}
    ordered = [by_name[k] for k in DISPLAY_ORDER if k in by_name]

    labels = [c["config"] for c in ordered]
    means  = np.array([c["mean_quality"] for c in ordered])
    ci_lo  = np.array([c["mean_quality"] - c["ci95_quality_lower"] for c in ordered])
    ci_hi  = np.array([c["ci95_quality_upper"] - c["mean_quality"] for c in ordered])
    colors = [CONFIG_META.get(l, {}).get("color", "#888888") for l in labels]
    stars  = [sig_stars(c.get("pValue_quality_corrected")) for c in ordered]

    fig, ax = plt.subplots(figsize=(COL2, 2.9))

    y = np.arange(len(labels))
    bars = ax.barh(
        y, means,
        xerr=[ci_lo, ci_hi],
        color=colors, height=0.55, capsize=3,
        error_kw={"linewidth": 0.8, "ecolor": "#333333", "capthick": 0.8},
        zorder=3,
    )

    for bar, label in zip(bars, labels):
        hatch = CONFIG_META.get(label, {}).get("hatch", "")
        if hatch:
            bar.set_hatch(hatch)
            bar.set_edgecolor("white")
        else:
            bar.set_edgecolor("none")

    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    ax.invert_yaxis()
    ax.set_xlabel("Mean Quality Score (0–10)")
    ax.set_title("Mean Quality per Configuration with 95% CI", pad=5)
    ax.set_xlim(0, 11.5)
    ax.grid(axis="x")
    ax.grid(False, axis="y")
    ax.set_axisbelow(True)

    for mv, bar, star in zip(means, bars, stars):
        label_str = f"{mv:.2f}"
        if star and star != "ns":
            label_str += f"  {star}"
        ax.text(
            mv + 0.08, bar.get_y() + bar.get_height() / 2,
            label_str, va="center", ha="left", fontsize=FONT_ANNOT,
        )

    bline  = mpatches.Patch(facecolor="#666666", label="Baseline")
    casc   = mpatches.Patch(facecolor="#aaaaaa", hatch="///", edgecolor="white", label="Cascade")
    ax.legend(handles=[bline, casc], loc="lower right", fontsize=FONT_LEGEND)

    save(fig, folder, "fig_quality_comparison.png")


# ── Figure 3: Mean Tokens comparison ─────────────────────────────────────────

def fig_tokens_comparison(summary: dict, folder: str) -> None:
    by_name = {c["config"]: c for c in summary["configs"]}
    ordered = [by_name[k] for k in DISPLAY_ORDER if k in by_name]

    labels = [c["config"] for c in ordered]
    means  = np.array([c["mean_tokens"] for c in ordered])
    ci_lo  = np.array([c["mean_tokens"] - c["ci95_tokens_lower"] for c in ordered])
    ci_hi  = np.array([c["ci95_tokens_upper"] - c["mean_tokens"] for c in ordered])
    colors = [CONFIG_META.get(l, {}).get("color", "#888888") for l in labels]
    stars  = [sig_stars(c.get("pValue_tokens_corrected")) for c in ordered]

    fig, ax = plt.subplots(figsize=(COL2, 2.9))

    y = np.arange(len(labels))
    bars = ax.barh(
        y, means / 1_000,   # display in thousands
        xerr=[ci_lo / 1_000, ci_hi / 1_000],
        color=colors, height=0.55, capsize=3,
        error_kw={"linewidth": 0.8, "ecolor": "#333333", "capthick": 0.8},
        zorder=3,
    )

    for bar, label in zip(bars, labels):
        hatch = CONFIG_META.get(label, {}).get("hatch", "")
        if hatch:
            bar.set_hatch(hatch)
            bar.set_edgecolor("white")
        else:
            bar.set_edgecolor("none")

    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    ax.invert_yaxis()
    ax.set_xlabel("Mean Total Tokens (thousands)")
    ax.set_title("Mean Token Usage per Configuration with 95% CI", pad=5)
    ax.grid(axis="x")
    ax.grid(False, axis="y")
    ax.set_axisbelow(True)

    x_max = float(((means + ci_hi) / 1_000).max())
    for mv, bar, star in zip(means, bars, stars):
        label_str = f"{mv/1000:.1f}k"
        if star and star != "ns":
            label_str += f"  {star}"
        ax.text(
            x_max * 1.01, bar.get_y() + bar.get_height() / 2,
            label_str, va="center", ha="left", fontsize=FONT_ANNOT,
        )

    ax.set_xlim(right=x_max * 1.18)

    bline  = mpatches.Patch(facecolor="#666666", label="Baseline")
    casc   = mpatches.Patch(facecolor="#aaaaaa", hatch="///", edgecolor="white", label="Cascade")
    ax.legend(handles=[bline, casc], loc="lower right", fontsize=FONT_LEGEND)

    save(fig, folder, "fig_tokens_comparison.png")


# ── Figure 4: Mean Drift comparison (cascade only) ───────────────────────────

def fig_drift_comparison(summary: dict, folder: str) -> None:
    by_name = {c["config"]: c for c in summary["configs"]}
    cascade_order = [k for k in DISPLAY_ORDER if k in by_name
                     and by_name[k]["mode"] == "cascade"]
    ordered = [by_name[k] for k in cascade_order]

    labels = [c["config"] for c in ordered]
    means  = np.array([c["mean_drift_score"] for c in ordered])
    colors = [CONFIG_META.get(l, {}).get("color", "#888888") for l in labels]

    fig, ax = plt.subplots(figsize=(COL1 + 0.5, 2.4))

    y = np.arange(len(labels))
    bars = ax.barh(y, means, color=colors, height=0.5, zorder=3)

    for bar, label in zip(bars, labels):
        hatch = CONFIG_META.get(label, {}).get("hatch", "")
        if hatch:
            bar.set_hatch(hatch)
            bar.set_edgecolor("white")
        else:
            bar.set_edgecolor("none")

    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    ax.invert_yaxis()
    ax.set_xlabel("Mean Drift Score")
    ax.set_title("Mean Drift Score\n(Cascade Configurations)", pad=5)
    ax.grid(axis="x")
    ax.grid(False, axis="y")
    ax.set_axisbelow(True)

    x_max = float(means.max()) if len(means) > 0 else 1.0
    for mv, bar in zip(means, bars):
        ax.text(
            mv + x_max * 0.02, bar.get_y() + bar.get_height() / 2,
            f"{mv:.2f}", va="center", ha="left", fontsize=FONT_ANNOT,
        )

    ax.set_xlim(right=x_max * 1.22)

    save(fig, folder, "fig_drift_comparison.png")


# ── Figure 5: Per-iteration cost curves ──────────────────────────────────────

def fig_iteration_cost(steps: list[dict], folder: str) -> None:
    # Group step costs by (config, stepNumber)
    data: dict[str, dict[int, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in steps:
        data[row["config"]][int(row["stepNumber"])].append(float(row["cost"]))

    max_step = max(int(r["stepNumber"]) for r in steps)

    fig, ax = plt.subplots(figsize=(COL2, 2.9))

    for config in DISPLAY_ORDER:
        if config not in data:
            continue
        meta      = CONFIG_META.get(config, {})
        step_nums = sorted(data[config].keys())
        y_means   = [float(np.mean(data[config][s])) for s in step_nums]
        ax.plot(
            step_nums, y_means,
            label=config,
            color=meta.get("color", "#888888"),
            linestyle=meta.get("ls", "-"),
            marker=meta.get("marker", "o"),
            linewidth=1.4, markersize=3.5, markeredgewidth=0.5,
            markeredgecolor="white",
        )

    ax.set_xlabel("Iteration (step number)")
    ax.set_ylabel("Mean Step Cost (USD)")
    ax.set_title("Per-Iteration Cost Across Configurations", pad=5)
    ax.set_xticks(range(1, max_step + 1))
    ax.grid(axis="both")
    ax.set_axisbelow(True)

    ax.legend(
        loc="upper left", fontsize=FONT_LEGEND, ncol=2,
        framealpha=0.9, handlelength=2,
    )

    save(fig, folder, "fig_iteration_cost.png")


# ── Figure 6: Per-iteration drift curves ─────────────────────────────────────

def fig_iteration_drift(steps: list[dict], folder: str) -> None:
    data: dict[str, dict[int, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in steps:
        data[row["config"]][int(row["stepNumber"])].append(float(row["driftScore"]))

    max_step = max(int(r["stepNumber"]) for r in steps)

    fig, ax = plt.subplots(figsize=(COL2, 2.9))

    for config in DISPLAY_ORDER:
        if config not in data:
            continue
        meta      = CONFIG_META.get(config, {})
        step_nums = sorted(data[config].keys())
        y_means   = [float(np.mean(data[config][s])) for s in step_nums]
        ax.plot(
            step_nums, y_means,
            label=config,
            color=meta.get("color", "#888888"),
            linestyle=meta.get("ls", "-"),
            marker=meta.get("marker", "o"),
            linewidth=1.4, markersize=3.5, markeredgewidth=0.5,
            markeredgecolor="white",
        )

    ax.set_xlabel("Iteration (step number)")
    ax.set_ylabel("Mean Drift Score")
    ax.set_title("Per-Iteration Drift Score Across Configurations", pad=5)
    ax.set_xticks(range(1, max_step + 1))
    ax.grid(axis="both")
    ax.set_axisbelow(True)

    ax.legend(
        loc="upper left", fontsize=FONT_LEGEND, ncol=2,
        framealpha=0.9, handlelength=2,
    )

    save(fig, folder, "fig_iteration_drift.png")


# ── Figure 7: Cost–Quality scatter ───────────────────────────────────────────

def fig_cost_quality_tradeoff(summary: dict, folder: str) -> None:
    configs = summary["configs"]

    fig, ax = plt.subplots(figsize=(COL1 + 0.6, 2.8))

    for c in configs:
        name = c["config"]
        meta = CONFIG_META.get(name, {"color": "#888888", "mode": "baseline", "marker": "o"})
        marker = "o" if meta["mode"] == "baseline" else "s"
        color  = meta["color"]

        # 95% CI half-widths for x; stddev for y
        xerr_lo = c["mean_cost_usd"] - c["ci95_cost_lower"]
        xerr_hi = c["ci95_cost_upper"] - c["mean_cost_usd"]
        yerr    = c["stddev_quality"]

        ax.errorbar(
            c["mean_cost_usd"], c["mean_quality"],
            xerr=[[xerr_lo], [xerr_hi]], yerr=[[yerr], [yerr]],
            fmt="none", color=color, alpha=0.45, linewidth=0.8, capsize=2, capthick=0.8,
        )
        ax.scatter(
            c["mean_cost_usd"], c["mean_quality"],
            color=color, marker=marker, s=40, zorder=4, linewidths=0.5,
            edgecolors="white",
        )

        # Short label (strip 'baseline-' prefix for baselines to save space)
        short = name.replace("baseline-", "b-")
        ax.annotate(
            short, (c["mean_cost_usd"], c["mean_quality"]),
            textcoords="offset points", xytext=(5, 3),
            fontsize=FONT_ANNOT,
        )

    ax.set_xlabel("Mean Total Cost (USD)")
    ax.set_ylabel("Mean Quality Score (0–10)")
    ax.set_title("Cost–Quality Trade-off", pad=5)
    ax.grid(axis="both")
    ax.set_axisbelow(True)

    bline_h = plt.Line2D([0], [0], marker="o", color="w", markerfacecolor="#555555",
                          linestyle="None", markersize=5, label="Baseline")
    casc_h  = plt.Line2D([0], [0], marker="s", color="w", markerfacecolor="#555555",
                          linestyle="None", markersize=5, label="Cascade")
    ax.legend(handles=[bline_h, casc_h], fontsize=FONT_LEGEND, loc="lower right")

    save(fig, folder, "fig_cost_quality_tradeoff.png")


# ── Figure 8: Cost distribution box plots ────────────────────────────────────

def fig_cost_distribution(runs: list[dict], folder: str) -> None:
    grouped: dict[str, list[float]] = defaultdict(list)
    for row in runs:
        grouped[row["config"]].append(float(row["totalCostUsd"]))

    labels = [k for k in DISPLAY_ORDER if k in grouped]
    values = [grouped[k] for k in labels]
    colors = [CONFIG_META.get(l, {}).get("color", "#888888") for l in labels]

    fig, ax = plt.subplots(figsize=(COL2, 2.9))

    bp = ax.boxplot(
        values, patch_artist=True, notch=False, vert=True,
        medianprops={"color": "white",   "linewidth": 1.5},
        whiskerprops={"linewidth": 0.7,  "color": "#444444"},
        capprops={"linewidth": 0.7,      "color": "#444444"},
        flierprops={"marker": "o", "markersize": 2.5, "alpha": 0.5,
                    "markeredgewidth": 0.5},
        zorder=3,
    )

    for patch, color, label in zip(bp["boxes"], colors, labels):
        patch.set_facecolor(color)
        patch.set_alpha(0.82)
        hatch = CONFIG_META.get(label, {}).get("hatch", "")
        if hatch:
            patch.set_hatch(hatch)
            patch.set_edgecolor("white")

    ax.set_xticks(range(1, len(labels) + 1))
    ax.set_xticklabels(labels, rotation=28, ha="right", fontsize=FONT_TICK)
    ax.set_ylabel("Total Cost per Run (USD)")
    ax.set_title("Cost Distribution by Configuration (n = 10 runs each)", pad=5)
    ax.grid(axis="y")
    ax.grid(False, axis="x")
    ax.set_axisbelow(True)

    save(fig, folder, "fig_cost_distribution.png")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate publication-quality PNG figures from RazorCascade data.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "folder",
        help="Path to the experiment data folder (must contain summary.json, runs.csv, steps.csv)",
    )
    args = parser.parse_args()

    folder = os.path.abspath(args.folder)
    if not os.path.isdir(folder):
        print(f"Error: folder not found: {folder}", file=sys.stderr)
        sys.exit(1)

    missing = [f for f in ("summary.json", "runs.csv", "steps.csv")
               if not os.path.isfile(os.path.join(folder, f))]
    if missing:
        print(f"Error: missing required files: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading data from: {folder}")
    summary = load_summary(folder)
    runs    = load_csv(folder, "runs.csv")
    steps   = load_csv(folder, "steps.csv")

    apply_style()

    print("Generating figures...")
    fig_cost_comparison(summary, folder)
    fig_quality_comparison(summary, folder)
    fig_tokens_comparison(summary, folder)
    fig_drift_comparison(summary, folder)
    fig_iteration_cost(steps, folder)
    fig_iteration_drift(steps, folder)
    fig_cost_quality_tradeoff(summary, folder)
    fig_cost_distribution(runs, folder)

    print("Done. 8 figures saved to:", folder)


if __name__ == "__main__":
    main()
