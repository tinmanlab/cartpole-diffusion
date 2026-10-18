"""Fast regression tests for the training-side teaching contract."""

import math
import unittest

import numpy as np

from training.cartpole_core import (
    DIFFUSION_STEPS,
    HORIZON,
    alpha_bar,
    build_features,
    physics_step,
    rollout_action_chunk,
    teacher_force,
)


class CoreTests(unittest.TestCase):
    def test_upright_is_equilibrium_without_force(self):
        state = np.zeros(4, dtype=np.float32)
        np.testing.assert_allclose(physics_step(state, 0.0), state, atol=1e-7)

    def test_teacher_catches_pole_in_lean_direction(self):
        right = np.array([0.0, 0.0, math.radians(8.0), 0.0], dtype=np.float32)
        left = -right
        self.assertGreater(teacher_force(right), 0.0)
        self.assertLess(teacher_force(left), 0.0)

    def test_chunk_and_features_have_expected_shape(self):
        states = np.zeros((3, 4), dtype=np.float32)
        clean = rollout_action_chunk(states)
        self.assertEqual(clean.shape, (3, HORIZON))
        features = build_features(clean, np.array([1, 50, 99]), states)
        self.assertEqual(features.shape, (3, HORIZON + 4 + 16))

    def test_cosine_schedule_decreases(self):
        values = alpha_bar(np.arange(0, DIFFUSION_STEPS + 1))
        self.assertAlmostEqual(float(values[0]), 1.0, places=5)
        self.assertTrue(np.all(np.diff(values) <= 1e-7))
        self.assertLess(float(values[-1]), 1e-3)


if __name__ == "__main__":
    unittest.main()
