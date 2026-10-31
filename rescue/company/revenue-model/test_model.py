import unittest
import numpy as np
from purchase_hazard import log_posterior,purchase_curve,sample_posterior
class ModelTests(unittest.TestCase):
 def test_exact_constant_hazard(self):
  p=purchase_curve(np.array([[np.log(.1)]]),np.ones((2,1)),[1,2])[:,0]
  np.testing.assert_allclose(p,1-np.exp(-np.array([.1,.3])))
 def test_censored_exposure_is_not_permanent_failure(self):
  a=log_posterior(np.array([np.log(.1)]),np.ones((1,1)),[1],[0],[])
  b=log_posterior(np.array([np.log(.1)]),np.ones((1,1)),[2],[0],[])
  self.assertAlmostEqual(b-a,-.1)
 def test_event_likelihood(self):
  a=log_posterior(np.array([np.log(.1)]),np.ones((1,1)),[1],[0],[])
  b=log_posterior(np.array([np.log(.1)]),np.ones((1,1)),[1],[1],[])
  self.assertAlmostEqual(b-a,np.log(.1))
 def test_small_sample_guard(self):
  with self.assertRaises(ValueError):sample_posterior(np.ones((6,1)),np.ones(6),np.ones(6),[])
if __name__=='__main__':unittest.main()
