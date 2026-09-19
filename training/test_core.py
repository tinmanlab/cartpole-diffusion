import math,unittest
import numpy as np
from training.cartpole_core import DIFFUSION_STEPS,HORIZON,alpha_bar,build_features,physics_step,rollout_action_chunk,teacher_force

class CoreTests(unittest.TestCase):
    def test_upright_equilibrium(self):
        s=np.zeros(4,dtype=np.float32)
        np.testing.assert_allclose(physics_step(s,0.0),s,atol=1e-7)
    def test_teacher_direction(self):
        r=np.array([0,0,math.radians(8),0],dtype=np.float32)
        self.assertGreater(float(teacher_force(r)),0)
        self.assertLess(float(teacher_force(-r)),0)
    def test_shapes(self):
        s=np.zeros((3,4),dtype=np.float32); a=rollout_action_chunk(s)
        self.assertEqual(a.shape,(3,HORIZON))
        self.assertEqual(build_features(a,np.array([1,50,99]),s).shape,(3,36))
    def test_schedule(self):
        x=alpha_bar(np.arange(DIFFUSION_STEPS+1))
        self.assertAlmostEqual(float(x[0]),1.0,places=5)
        self.assertTrue(np.all(np.diff(x)<=1e-7))
        self.assertLess(float(x[-1]),1e-3)
if __name__=="__main__":unittest.main()
