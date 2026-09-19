# Cart-Pole Diffusion

Interactive control-loop-first explainer for understanding what a diffusion policy actually does.

**Live:** https://tinmanlab.github.io/cartpole-diffusion/

## Current teaching flow

The default page is organized around one closed control cycle:

```text
Plant
  ↓ observe
[x, x_dot, theta, theta_dot]
  ↓
Diffusion Policy
  ↓ generate 16 future forces
[a0 ... a15]
  ↓ execute first 4
Cart-Pole
  ↓
observe again and replan
```

## Atomic live tick snapshots

The live controller now follows the atomic snapshot contract adopted from the latest `tinmanlab/cartpole-transformer` v0.6 work, adapted for Diffusion Policy action chunks.

A rendered live snapshot means:

```text
current plant state
+ current plan snapshot
+ current next action a[cursor]
        ↓ Step / next 20 ms tick
physics transition
        ↓
cursor advances
        ↓
if cursor < 4:
    keep the same plan observation
    expose the next action from the same chunk
else:
    re-observe immediately on the post-transition state
    generate a fresh 16-action plan
    expose its new a[0]
        ↓
render the next atomic snapshot
```

The displayed force in live mode is therefore the force that will be applied on the **next** 20 ms transition, not the force that was already consumed to reach the displayed pose.

The Plant panel exposes the current simulation tick. When paused, **Step 20 ms** advances exactly one physics tick.

The plan observation intentionally stays frozen for the four-action execution prefix. The UI labels:

- the tick at which the current plan was generated,
- the current plant tick,
- the plan age in ticks.

After the fourth action, replanning happens immediately in the same transition. The new plan observation must equal the newly displayed plant state and the next action resets to `a[0]`.

Browser QA numerically verifies:

- Step advances exactly one tick,
- the previously displayed next force becomes the recorded last-applied force,
- cursor increments one action per tick inside the prefix,
- plan observation stays unchanged while cursor advances,
- the fourth action triggers immediate replan,
- the fresh plan observation equals the post-transition plant state,
- the displayed next force always matches the current `plan[cursor]`.

## Deterministic three-seed closed-loop replay

The latest `cartpole-transformer` Compare mode was used as the interaction reference for a separate **Replay** mode.

Replay does not compare different controller architectures. All three environments use the same:

- learned diffusion denoiser,
- Cart-Pole dynamics,
- initial state,
- 4-action execution prefix,
- replanning rule,
- deterministic disturbance schedule.

Only the deterministic Gaussian seed stream differs:

```text
Seed 10101
Seed 20202
Seed 30303
```

Each seed stream owns an independent Cart-Pole state. Every environment receives the same disturbance at the same simulation tick:

```text
+4 N : ticks 80..87
-4 N : ticks 190..197
+4 N : ticks 300..307
-4 N : ticks 410..417
```

The 10 s run is fully recorded as 501 snapshots (tick 0 through tick 500), so the replay can be paused, scrubbed, restarted, or jumped to the end without recomputing a different episode.

The deterministic runtime checker generates the entire replay twice and requires byte-identical traces. It also checks that:

- all three controllers start from exactly the same state,
- their base seed streams are distinct,
- all receive the same disturbance at every tick,
- the +4 N pulse is present at replay tick 81,
- the closed-loop states have diverged by tick 120,
- all recorded states/forces/metrics are finite,
- any failed controller would freeze at its failure pose with zero future force.

In the current fixed 10 s configuration all three seed streams survive the full horizon. Their raw summaries are:

| seed stream | survival | max |theta| | mean |theta| | control effort |
| --- | ---: | ---: | ---: | ---: |
| 10101 | 10.0 s | 5.0 deg | 1.27 deg | 8.73 N·s |
| 20202 | 10.0 s | 5.0 deg | 1.23 deg | 8.62 N·s |
| 30303 | 10.0 s | 5.0 deg | 1.27 deg | 8.71 N·s |

These numbers describe this deterministic replay only. The UI intentionally keeps the raw metrics visible without declaring a winner or treating the three traces as calibrated uncertainty.

## Guided one-cycle walkthrough

For a first pass, use **한 cycle 설명** instead of trying to read the live page while it is moving.

The walkthrough freezes live physics and uses one real planning cycle:

```text
1/6 observe
2/6 random action candidates
3/6 denoise
4/6 final 16-action plan
5/6 physically apply a[0] ... a[3] for 0.08 s
6/6 observe the changed plant again
```

After executing the four commands, the walkthrough shows the before → after values for `x`, `x_dot`, `theta`, and `theta_dot`. Those after-values become the next cycle’s actual observation. Pressing **다음 cycle** generates a new diffusion plan from that changed plant state. Exiting the walkthrough returns to the normal live controller.

The guided mode does not synthesize separate teaching data: it freezes and reveals the same observation, denoising history, final plan, and physics update used by the live policy.

## Full 19-step denoise scrubber

Guided step **3/6 · Denoise** now exposes the entire deterministic DDIM path used by the current plan.

The planning history contains 20 candidate states and 19 adjacent updates:

```text
t=95 → 90 → 85 → ... → 10 → 5 → 0
  1      2                  18    19
```

The scrubber selects one of those 19 real updates. The one-step panel underneath is not a separate example: it follows the selected adjacent pair from the same history.

A tracked action index can also be changed from `a[0]` to any of `a[0]...a[15]`. The trajectory plot then shows that action slot across all 20 candidate states while the one-step view reports the same selected action index.

Claim boundary:

- values before `t=0` are internal action-space candidates, not physical Newton commands;
- the final `t=0` sequence is the executable normalized action plan;
- the browser still executes only the first four actions before re-observing and replanning.

Browser QA scrubs from the first update `95→90`, through `50→45`, to the final update `5→0`, changes the tracked action index, and verifies that the one-step view follows the same selection on desktop and mobile.

## One real denoising update

Guided step **3/6 · Denoise** now opens one actual reverse-diffusion update from the current planning history.

The representative step is:

```text
current candidate at t=50
        ↓
learned denoiser predicts epsilon_theta
        ↓
DDIM uses that prediction + diffusion schedule
        ↓
next candidate at t=45
```

The UI shows the real `a[0]` values for the current candidate, predicted epsilon, and next candidate, plus an overlay of all 16 action positions before and after the update.

Important claim boundary:

- `epsilon_theta` is an internal noise prediction, not a force command.
- DDIM does not simply subtract `epsilon_theta`; it uses the diffusion schedule to compute the next candidate.
- only the final t=0 action sequence is converted into the executable force plan.

The browser QA checks that this panel appears only at guided step 3/6, reads the actual t=50 → 45 history entry, contains finite model values, changes the action candidate, and remains readable without horizontal overflow on mobile.

## Where observation conditioning enters the denoise path

The same-noise comparison now preserves both complete 20-state candidate histories, not only the final plans.

For the tracked `a[0]` slot:

```text
t=95
A and B start at exactly the same candidate
        ↓ first learned denoiser call sees different observations
t=90
the two candidates have already diverged
        ↓
t≈50
the separation has grown
        ↓
t=0
the two final action plans remain different
```

In the deterministic QA run:

- initial `a[0]` difference at `t=95`: `0.000`
- after the first `95→90` reverse update: about `0.007`
- around `t=50`: about `0.449`
- final normalized `a[0]` difference at `t=0`: about `0.907`

The full-model runtime check also compares all 16 action slots and requires the two histories to start identically and diverge immediately after the first reverse update.

This visualization still has a narrow claim boundary: it demonstrates where the changed observation affects this fixed model/sampler computation. It does not by itself establish general causal structure outside that controlled computation.

## Observation conditioning: same noise, different state

Guided step **1/6 · 관측** now includes a controlled sensitivity experiment that isolates the observation input.

Both comparison runs use:

- the same learned denoiser,
- the same fixed Gaussian latent generated from seed `424242`,
- the same DDIM schedule and 19 reverse updates.

Only the observation changes:

```text
A = [x=0, x_dot=0, theta=+5 deg, theta_dot=0]
B = [x=0, x_dot=0, theta=-5 deg, theta_dot=0]
```

The two final 16-action plans are plotted on the same force axis. Because the starting noise is held fixed, any difference between the two generated plans comes from the changed observation condition inside this model/sampler computation.

This is a model-input sensitivity demonstration, not a claim that the two plans must be exact sign mirrors or that the visualization establishes a broader causal interpretation outside this controlled computation.

Runtime QA independently reconstructs the same fixed-noise experiment and requires the full DDIM plans to differ when only the pole-angle sign changes. Browser QA verifies the comparison is shown only at guided step 1/6, uses seed 424242, uses ±5 degree theta inputs, produces finite differing plans, remains readable on mobile, and disappears at step 2/6.

## Sampling diversity: same state, different noise

Guided step **1/6 · 관측** now contains a second controlled experiment that isolates the stochastic starting latent.

This experiment fixes:

- the learned denoiser,
- the observation at `[0, 0, +5 deg, 0]`,
- the DDIM schedule and 19 reverse updates.

Only the Gaussian seed changes:

```text
seed 10101
seed 20202
seed 30303
```

Because the seeds are different, the three runs already start from different candidates at `t=95`. They produce three distinct final 16-action samples under the same observation.

In the deterministic browser QA example:

- initial `a[0]` candidate spread: about `0.765` normalized action units,
- first forces: about `+4.25 N`, `+3.92 N`, and `+4.63 N`,
- mean pairwise difference over the final plans: about `0.35 N`,
- maximum pairwise final-plan difference: about `0.77 N`.

The independent runtime check also reconstructs the same three seeds and reports:

- minimum pairwise initial-latent max difference: about `2.334`,
- mean pairwise final-plan normalized difference: about `0.035`,
- maximum pairwise final-plan normalized difference: about `0.077`.

In this particular controlled toy example, the ±5 degree observation intervention produces a larger final-plan separation than these three seed changes. That is an observation about this fixed model, state, seeds and sampler configuration only; it is not a general ranking of conditioning effects versus sampling effects.

Most importantly, the spread among these three samples is **sampling diversity only**. It is not a calibrated probability distribution, uncertainty estimate, confidence score, or guarantee about control robustness.

Together, the two step-1 experiments separate two mechanisms:

```text
same noise + different observation
→ same t=95 candidate
→ paths split after the first conditioned denoiser update

same observation + different noise
→ different t=95 candidates already
→ different sampled plans after denoising
```

## What diffusion does

The default denoising visualization now uses one shared force-sequence axis instead of three dense bar grids.

It shows three real snapshots from the same planning cycle:

```text
A · random future-force candidates
        ↓ conditioned on observation
B · partially denoised force pattern
        ↓ more denoising
C · final executable force plan
```

All three rows use the same 16 future-action indices and the same force scale. The first four actions of the final plan are shaded as the **execute region**, making the connection to the physical controller explicit.

Plain-language meaning:

- **Noise** = a random internal future-force sequence. It is not sent to the plant.
- **Denoise** = repeatedly edit that sequence using the current observation and diffusion timestep.
- **Final plan** = the 16-step force sequence produced at t=0.
- **Execution** = apply only a[0] to a[3], then observe the plant again and replan.

## Readability

The UI uses readable default typography instead of shrinking labels to fit:

- body: 15 px
- major panel headings: 15–18 px
- control-loop step titles: 16 px
- observation values: 17 px
- current applied force: 22 px

When horizontal space is insufficient, layout is allowed to reflow instead of reducing text below the readability contract.

## Prediction horizon vs execution horizon

The execution view now makes the receding-horizon contract explicit.

At 50 Hz, each action lasts 0.02 s:

```text
prediction horizon
16 actions × 0.02 s = 0.32 s planned

execution horizon
 4 actions × 0.02 s = 0.08 s executed
                         ↑
                    re-observe here
```

The first four actions are the only commands applied before the next observation. The remaining old `a[4]...a[15]` are not continued after re-observation; they are replaced by a freshly generated 16-action plan conditioned on the changed Cart-Pole state.

This is the receding-horizon behavior the visualizer is teaching. The browser QA checks the 16/4 split, the 0.32/0.08 s timing, the 25% re-observation marker, the discarded 12-action tail after execution, and the reset to a fresh horizon on the next cycle.

## Relation to Diffusion Policy

This toy deliberately keeps the observation horizon at 1:

- observation: `[x, x_dot, theta, theta_dot]`
- prediction horizon: 16 forces
- executed prefix: 4 forces
- replanning: after those 4 actions

That preserves the key receding-horizon idea while keeping every value inspectable.

## Live simulation

- browser Cart-Pole physics: 50 Hz
- learned state-conditioned denoiser
- Gaussian start latent: t=95
- DDIM stride: 5
- prediction horizon: 16
- execute prefix: 4
- controls: Pause/Run, paused single-tick **Step 20 ms**, Reset, temporary left/right disturbance

## Advanced view

The detailed timestep ladder and `a_t / predicted epsilon / estimated a0 / next latent` inspector remain available under **Advanced** for users who want the internal math after understanding the control loop.

## Validation

The validation structure is adapted from `cartpole-transformer` but kept specific to this static diffusion lab.

### Runtime / semantic checks

- Python dynamics and diffusion-core tests
- quantized browser-model load and inference
- model metadata / feature-width / conditioning invariants
- deterministic inference
- timestep and state-conditioning sensitivity
- browser inference latency threshold
- deterministic 10-second 50 Hz learned-policy rollout
- inline page and visualization syntax
- readability regression contract

### Browser visual QA

A Playwright Chromium workflow serves the exact static files that will be deployed and checks both desktop and mobile layouts.

It verifies:

- no page-level horizontal overflow
- no Plant / Controller overlap
- minimum core font size
- four observation values and four executed-prefix actions
- three denoising sequence snapshots
- the final execute region and four execute points
- simulation clock and plan number advance
- denoising visualization changes as replanning occurs
- Pause freezes the simulation
- Push changes the visible Cart-Pole state
- atomic live snapshots keep plant tick, plan snapshot, cursor and next force synchronized; paused Step advances exactly one 20 ms tick
- guided mode freezes live physics, applies exactly four actions, shows four before/after state comparisons, and restarts the next cycle from the after-state
- Advanced opens correctly
- no browser console / page errors
- mobile uses the vertical A → B → C denoising cards without horizontal scrolling

Every run uploads `desktop.jpg`, `desktop-advanced.jpg`, `mobile.jpg`, and `report.json` as a GitHub Actions artifact.

### Deployment gate

GitHub Pages now repeats the core runtime, readability, model-runtime, and closed-loop checks before uploading the site. A broken browser runtime therefore cannot be published merely because the static files exist.

## References

See [NOTICE.md](NOTICE.md).

## License

MIT.
