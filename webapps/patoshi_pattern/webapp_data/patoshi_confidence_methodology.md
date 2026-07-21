# Dual-axis Patoshi block confidence methodology

## Purpose

The script assigns a value from 0 to 1 to every row where `patoshi_updated == 1`. The score estimates how consistently a candidate behaves like a Patoshi-pattern block rather than a block from another miner whose extranonce trajectory happened to cross the identified pattern.

The model is explicitly designed around the proposed false-positive mechanism:

1. another miner has a coherent extranonce line;
2. that line geometrically intersects a Patoshi line near the candidate;
3. the candidate is mistakenly attributed to the Patoshi miner; and
4. the spending history of that competing line either strengthens or weakens that explanation.

This is an **internally calibrated confidence score relative to the supplied labels and dataset**. It is not independent historical proof that Satoshi mined a block.

## Why the model uses two axes

### Block height is the primary geometric axis

Block height is exact, strictly ordered, and cannot reverse. The extranonce patterns in this dataset are modestly straighter when height is used as the horizontal axis. Height is therefore used to determine the primary competing-line membership and the spending evidence associated with that line.

Height is normalized as:

`height_equivalent_days = (height - minimum_height) / 144`

This does not assert that every historical day contained exactly 144 blocks. It places height and timestamp on comparable scales so the same local window and decay parameters can be interpreted consistently.

The default height window is equivalent to:

- 12 days, or 1,728 blocks, on each side;
- a four-day, or 576-block, exponential decay scale; and
- a minimum separation of one block.

### Timestamp is retained as independent evidence

Block-header timestamps are noisy and miner-supplied. In this dataset, adjacent-height timestamps include:

- 1,568 negative intervals;
- 53 identical timestamps; and
- a maximum backward movement of 7,115 seconds.

That noise makes timestamp inferior as the sole coordinate for geometric intersection testing. However, timestamp behavior can still carry independent miner-specific information. The model therefore calculates a second complete set of trajectory and density features using timestamp, with:

- a 12-day window on each side;
- a four-day exponential decay scale; and
- a minimum separation of ten minutes.

## Local Hough trajectory measurement

For a candidate at coordinate `c0` and extranonce `x0`, every nearby block at `(c, x)` implies a slope:

`m = (x - x0) / (c - c0)`

Blocks on a coherent line through the candidate imply similar slopes. The script constructs a weighted local Hough histogram of positive slopes separately for:

1. `patoshi_updated == 1` blocks; and
2. `patoshi_updated == 0` blocks.

This is performed once in height space and once in timestamp space.

Votes are:

- restricted to slopes from 0 to 6,000 extranonce units per equivalent day;
- placed in bins 20 units wide;
- smoothed with a 1.25-bin Gaussian kernel;
- exponentially downweighted with coordinate distance; and
- rewarded when the same slope has support on both sides of the candidate.

The strongest slope is refined with weighted least squares. A block belongs to the inferred line only when its extranonce residual is within 24 units of the refined line. This fixed-width tube prevents a line from becoming an increasingly wide wedge at longer distances.

The resulting components include:

- pattern-line support;
- competing-line support;
- peak concentration above diffuse Hough background;
- bilateral continuity;
- inferred slope;
- supporting block count; and
- local pattern and non-pattern density.

## Density outside the Patoshi pattern

The score includes local non-pattern density on both axes. A candidate surrounded by many other miners' blocks has more opportunities for accidental trajectory crossings than one in a sparse region.

All Patoshi-labelled rows are retained for calibration. Non-pattern controls are sampled within seven-day time strata containing Patoshi blocks and are weighted back to their original stratum prevalence. This prevents the classifier from obtaining deceptively strong results merely by learning that Patoshi labels are concentrated in particular historical periods.

## Spentness evidence

Spentness is derived from the strongest **height-based competing line**, because height provides the primary and least ambiguous line membership.

The competing line's probability of remaining unspent is estimated with a beta-binomial empirical-Bayes model. The estimate is shrunk toward the overall non-pattern unspent rate with prior strength 6:

- short or noisy lines remain close to the global non-pattern rate;
- long, consistently spent lines can provide strong evidence; and
- no line is treated as having an exact probability of zero or one.

The candidate's observed spent state is converted into a log Bayes factor comparing:

- the empirical spent/unspent frequency of Patoshi-labelled blocks; and
- the estimated frequency of the height-derived competing line.

This formalizes the intuition that an unspent candidate is less plausibly the sole surviving block from an otherwise completely spent miner line.

A timestamp-derived spentness factor is included only in the diagnostics and the time-only sensitivity model. It is deliberately excluded from the combined score to avoid counting the same behavioral evidence twice.

## Combined feature model

The combined model contains:

- all height-based geometry, density, and spentness features;
- timestamp-based geometry and density features;
- no second timestamp spentness term; and
- four cross-axis agreement features measuring relative support and minimum bilateral continuity.

Regularized logistic regression maps these features to values between 0 and 1.

## Cross-fitting and calibration

The output confidence for a Patoshi-labelled block is an out-of-fold probability. The default calibration uses five-fold `StratifiedGroupKFold` with complete seven-day time groups held out together. This is more conservative than randomly splitting individual blocks because neighboring blocks can be strongly correlated.

The final all-data model is fitted only to report standardized coefficients. It is not used to replace the out-of-fold confidence values written to Patoshi-labelled rows.

Three known Satoshi anchors are explicitly overridden to `1.000000` after model scoring: height 0, the genesis block; height 9, the coinbase reward spent in block 170 for the Hal Finney payment; and height 5326, the coinbase reward spent in block 11408 for the Mike Hearn payment.

## Full-dataset results

The completed run used:

- 100,000 total rows;
- 22,491 Patoshi-labelled blocks;
- 14,207 time-matched sampled controls; and
- five grouped calibration folds.

### Label-consistency metrics

| Model | ROC AUC | Brier score | Log loss |
|---|---:|---:|---:|
| Height only | 0.997548 | 0.018666 | 0.062628 |
| Timestamp only | **0.998164** | **0.016192** | **0.054448** |
| Combined dual axis | 0.998116 | 0.016521 | 0.055491 |

Lower Brier score and log loss are better.

The combined model is substantially stronger than height alone but is marginally behind timestamp alone at reproducing the supplied `patoshi_updated` labels under grouped cross-validation. This difference is small, but it should not be hidden. The reason for retaining the combined specification is methodological rather than an attempt to maximize in-sample label reproduction: height is the cleaner and more direct axis for the geometric intersection and competing-line spentness questions the confidence score is intended to answer.

These metrics measure consistency with the supplied labels, not independent historical accuracy.

### Combined confidence distribution among Patoshi-labelled blocks

- minimum: 0.000434;
- 1st percentile: 0.187464;
- 5th percentile: 0.753733;
- median: 0.999689;
- 95th percentile: 0.999995;
- maximum before CSV rounding: 0.999999865;
- 143 blocks below 0.10;
- 579 blocks below 0.50;
- 2,043 blocks below 0.90; and
- 4,728 blocks below 0.99.

## Output files

The compact output appends only `patoshi_confidence`:

- rows with `patoshi_updated == 1` receive a six-decimal score;
- the known Satoshi anchors at heights 0, 9, and 5326 are fixed to `1.000000`;
- other rows are blank in the confidence column.

The diagnostic output also appends:

- `height_only_confidence` and `time_only_confidence`;
- separately prefixed height and timestamp Hough components;
- local non-pattern density on each axis;
- height- and timestamp-derived competing slopes;
- competing-line block counts and spent fractions;
- the primary height-derived spentness Bayes factor; and
- cross-axis support ratios.

## Running the script

Install dependencies:

```bash
pip install -r patoshi_confidence_requirements.txt
```

Compact output:

```bash
python score_patoshi_confidence.py input.csv output.csv
```

Diagnostic output and explicit reports:

```bash
python score_patoshi_confidence.py input.csv output_diagnostics.csv \
  --diagnostics \
  --report-json confidence_report.json \
  --axis-comparison-json axis_comparison.json
```

The default is grouped cross-validation. A random block-level split is available only as a sensitivity check:

```bash
python score_patoshi_confidence.py input.csv output.csv --cv-mode random
```

## Interpretation

Suggested descriptive bands, not formal decision thresholds:

- `0.99–1.00`: very strong internal support;
- `0.90–0.99`: strong support;
- `0.50–0.90`: plausible but with meaningful ambiguity;
- `0.10–0.50`: weak or intersection-sensitive; and
- below `0.10`: substantial evidence for a competing explanation.

For academic use, report the raw continuous score and the diagnostic components. Do not present the bands as categorical historical truth.

## Important limitations

1. `patoshi_updated` defines the reference trajectories and the calibration target. The model is not independent validation of those labels.
2. The supplied labels of nearby blocks are used to construct local reference geometry, although the candidate itself cannot vote for its own line because zero coordinate gaps are excluded.
3. Extranonce trajectories are locally approximated as straight. Restarts, hardware changes, and line boundaries can lower otherwise valid confidence.
4. The conversion of height to equivalent days is a scaling convention. A formal paper should test alternatives such as raw block units and local block-production-rate normalization.
5. The 12-day window, four-day decay, slope limits, bin width, and 24-extranonce residual tolerance are modeling choices requiring sensitivity analysis.
6. Spentness is evidentiary, not dispositive. Different miners can have different key-loss, wallet, and spending behavior.
7. The probability is relative to the observations included in this CSV. Missing blocks, revised extranonce extraction, or revised Patoshi labels can change the result.
8. The combined model's slight metric deficit versus timestamp-only indicates that adding theoretically relevant information does not automatically improve prediction of the existing labels. The intended use should determine whether label reproduction or explicit intersection-risk modeling is the primary objective.
