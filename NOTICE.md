# Notices and references

## Polo Club of Data Science

Interaction and visual-explanation ideas are adapted from:

- Transformer Explainer: https://poloclub.github.io/transformer-explainer/
- Source: https://github.com/poloclub/transformer-explainer
- Diffusion Explainer: https://poloclub.github.io/diffusion-explainer/
- Source: https://github.com/poloclub/diffusion-explainer

Both are MIT licensed.

Upstream notice:

> MIT License  
> Copyright (c) 2022 Polo Club of Data Science

The current code is vanilla HTML/CSS/JavaScript written for this Cart-Pole diffusion lab. The linked action-index highlighting and progressive advanced inspection deliberately adapt interaction patterns previously identified in Transformer Explainer.

## MuJoCo Playground

The simplified v0.5 Cart-Pole drawing uses the official MuJoCo Playground / DM Control Cartpole asset as a **visual reference**:

- repository: https://github.com/google-deepmind/mujoco_playground
- cartpole environment: `mujoco_playground/_src/dm_control_suite/cartpole.py`
- cartpole XML: `mujoco_playground/_src/dm_control_suite/xmls/cartpole.xml`

The official asset represents the environment with rail geoms, a box cart, and a capsule pole. This repository does not vendor that XML, MuJoCo runtime, MJX, or MuJoCo Playground code; its browser dynamics remain independent.

MuJoCo Playground source is Apache-2.0 licensed.

## Diffusion Policy

Conceptual robotics reference:

Cheng Chi, Siyuan Feng, Yilun Du, Zhenjia Xu, Eric Cousineau, Benjamin Burchfiel, and Shuran Song. **Diffusion Policy: Visuomotor Policy Learning via Action Diffusion.** Robotics: Science and Systems (RSS), 2023.

- Project: https://diffusion-policy.cs.columbia.edu/
- Source: https://github.com/real-stanford/diffusion_policy

The Cart-Pole model is deliberately small and educational; it is not a reproduction of the paper's manipulation benchmarks.
