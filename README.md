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

CI checks:

- Python dynamics/diffusion core
- model load and inference
- control-loop visualization syntax
- inline page syntax
- readability regression contract
- deterministic 10-second 50 Hz learned-policy rollout

## References

See [NOTICE.md](NOTICE.md).

## License

MIT.
