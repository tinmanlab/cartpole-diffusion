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
- controls: Pause/Run, Reset, temporary left/right disturbance

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
