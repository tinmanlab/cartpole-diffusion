"""Shared Cart-Pole dynamics, teacher policy, diffusion schedule, and feature encoding."""

from __future__ import annotations

import math
from typing import Tuple

import numpy as np

DT = 0.02
GRAVITY = 9.8
MASS_CART = 1.0
MASS_POLE = 0.1
TOTAL_MASS = MASS_CART + MASS_POLE
HALF_POLE_LENGTH = 0.5
POLEMASS_LENGTH = MASS_POLE * HALF_POLE_LENGTH
MAX_FORCE = 10.0
HORIZON = 16
DIFFUSION_STEPS = 100
COSINE_S = 0.008
TIMESTEP_EMBED_DIM = 16

# Discrete LQR gain computed around the upright equilibrium for the dynamics below.
# u = gain @ [x, x_dot, theta, theta_dot], then clipped to +/- MAX_FORCE.
TEACHER_GAIN = np.array(
    [3.02047836, 5.99053209, 53.60976189, 14.17379801], dtype=np.float32
)

STATE_SCALE = np.array(
    [0.8, 1.2, math.radians(12.0), math.radians(100.0)], dtype=np.float32
)


def physics_step(state: np.ndarray, force: np.ndarray | float) -> np.ndarray:
    """One Euler step matching the browser Cart-Pole dynamics."""
    s = np.asarray(state, dtype=np.float32)
    single = s.ndim == 1
    if single:
        s = s[None, :]
    u = np.asarray(force, dtype=np.float32)
    if u.ndim == 0:
        u = np.full((s.shape[0],), float(u), dtype=np.float32)
    u = np.clip(u.reshape(-1), -MAX_FORCE, MAX_FORCE)

    x, x_dot, theta, theta_dot = s.T
    c = np.cos(theta)
    sn = np.sin(theta)
    temp = (u + POLEMASS_LENGTH * theta_dot * theta_dot * sn) / TOTAL_MASS
    theta_acc = (GRAVITY * sn - c * temp) / (
        HALF_POLE_LENGTH * (4.0 / 3.0 - MASS_POLE * c * c / TOTAL_MASS)
    )
    x_acc = temp - POLEMASS_LENGTH * theta_acc * c / TOTAL_MASS

    out = np.stack(
        [
            x + DT * x_dot,
            x_dot + DT * x_acc,
            theta + DT * theta_dot,
            theta_dot + DT * theta_acc,
        ],
        axis=1,
    ).astype(np.float32)
    return out[0] if single else out


def teacher_force(state: np.ndarray) -> np.ndarray | float:
    """Near-upright LQR teacher with actuator clipping."""
    s = np.asarray(state, dtype=np.float32)
    if s.ndim == 1:
        return float(np.clip(s @ TEACHER_GAIN, -MAX_FORCE, MAX_FORCE))
    return np.clip(s @ TEACHER_GAIN, -MAX_FORCE, MAX_FORCE).astype(np.float32)


def rollout_action_chunk(states: np.ndarray, horizon: int = HORIZON) -> np.ndarray:
    """Generate normalized demonstration action chunks from the teacher."""
    s = np.asarray(states, dtype=np.float32)
    single = s.ndim == 1
    if single:
        s = s[None, :]
    s = s.copy()
    out = np.empty((s.shape[0], horizon), dtype=np.float32)
    for i in range(horizon):
        u = np.asarray(teacher_force(s), dtype=np.float32)
        out[:, i] = u / MAX_FORCE
        s = physics_step(s, u)
    return out[0] if single else out


def sample_states(rng: np.random.Generator, count: int) -> np.ndarray:
    """Sample the v0.2 teaching domain around upright balance."""
    return rng.uniform(-STATE_SCALE, STATE_SCALE, size=(count, 4)).astype(np.float32)


def alpha_bar(timestep: np.ndarray | int | float) -> np.ndarray:
    """Cosine cumulative alpha schedule normalized so alpha_bar(0)=1."""
    t = np.asarray(timestep, dtype=np.float32)
    x = (t / DIFFUSION_STEPS + COSINE_S) / (1.0 + COSINE_S)
    f = np.cos(x * np.pi / 2.0)
    f0 = math.cos((COSINE_S / (1.0 + COSINE_S)) * math.pi / 2.0)
    return np.clip((f * f) / (f0 * f0), 1e-5, 1.0).astype(np.float32)


def timestep_embedding(timestep: np.ndarray | int, dim: int = TIMESTEP_EMBED_DIM) -> np.ndarray:
    """Fixed sinusoidal embedding mirrored exactly in app/tiny_denoiser.js."""
    t = np.asarray(timestep, dtype=np.float32).reshape(-1, 1) / DIFFUSION_STEPS
    freqs = (2.0 ** np.arange(dim // 2, dtype=np.float32)) * np.pi
    angles = t * freqs[None, :]
    return np.concatenate([np.sin(angles), np.cos(angles)], axis=1).astype(np.float32)


def build_features(noisy_action: np.ndarray, timestep: np.ndarray | int, state: np.ndarray) -> np.ndarray:
    """Concatenate noisy action, normalized condition, and timestep embedding."""
    a = np.asarray(noisy_action, dtype=np.float32)
    s = np.asarray(state, dtype=np.float32)
    single = a.ndim == 1
    if single:
        a = a[None, :]
    if s.ndim == 1:
        s = s[None, :]
    t = np.asarray(timestep)
    if t.ndim == 0:
        t = np.full((a.shape[0],), int(t), dtype=np.int32)
    return np.concatenate([a, s / STATE_SCALE, timestep_embedding(t)], axis=1).astype(np.float32)


def corrupt_action(
    clean_action: np.ndarray, timestep: np.ndarray | int, noise: np.ndarray
) -> Tuple[np.ndarray, np.ndarray]:
    """Forward diffusion q(a_t | a_0). Returns noisy action and alpha_bar."""
    clean = np.asarray(clean_action, dtype=np.float32)
    eps = np.asarray(noise, dtype=np.float32)
    t = np.asarray(timestep)
    if t.ndim == 0:
        ab = alpha_bar(int(t))
    else:
        ab = alpha_bar(t)[:, None]
    noisy = np.sqrt(ab) * clean + np.sqrt(1.0 - ab) * eps
    return noisy.astype(np.float32), np.asarray(ab, dtype=np.float32)
