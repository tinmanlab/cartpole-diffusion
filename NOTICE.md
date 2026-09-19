# Notices and references

## Polo Club of Data Science

This project uses interaction and visual-explanation ideas from:

- Transformer Explainer: https://poloclub.github.io/transformer-explainer/
- Transformer Explainer source: https://github.com/poloclub/transformer-explainer
- Diffusion Explainer: https://poloclub.github.io/diffusion-explainer/
- Diffusion Explainer source: https://github.com/poloclub/diffusion-explainer

Both upstream projects are available under the MIT License.

Upstream license notice:

> MIT License  
> Copyright (c) 2022 Polo Club of Data Science

### v0.3 visualization adaptation

The v0.3 Cart-Pole Diffusion UI was written independently in vanilla HTML/CSS/JavaScript, but deliberately adapts these interaction patterns from Transformer Explainer:

- `MatrixSvg.svelte`: linked cell highlighting with non-selected cells dimmed
- `Sankey.svelte`: visually connecting sequential computation stages
- `AttentionMatrix.svelte`: progressive reveal / inspect-one-stage-at-a-time interaction
- `Slider.svelte`: compact value scrubber presentation

No Transformer-specific Q/K/V or attention computation is reused. The patterns are applied only to diffusion action vectors and denoising timesteps.

## Diffusion Policy

Conceptual robotics reference:

Cheng Chi, Siyuan Feng, Yilun Du, Zhenjia Xu, Eric Cousineau, Benjamin Burchfiel, and Shuran Song. **Diffusion Policy: Visuomotor Policy Learning via Action Diffusion.** Robotics: Science and Systems (RSS), 2023.

- Project: https://diffusion-policy.cs.columbia.edu/
- Source: https://github.com/real-stanford/diffusion_policy

The Cart-Pole model is a deliberately small educational implementation and is not claimed as a reproduction of the paper's manipulation benchmarks.
