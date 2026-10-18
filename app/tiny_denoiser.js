(function (root) {
  "use strict";

  function silu(x) {
    var clamped = Math.max(-30, Math.min(30, x));
    var sigmoid = 1 / (1 + Math.exp(-clamped));
    return x * sigmoid;
  }

  function timestepEmbedding(timestep, dim, totalSteps) {
    var half = Math.floor(dim / 2);
    var scaled = timestep / totalSteps;
    var out = new Array(dim);
    for (var i = 0; i < half; i++) {
      var angle = scaled * Math.pow(2, i) * Math.PI;
      out[i] = Math.sin(angle);
      out[i + half] = Math.cos(angle);
    }
    return out;
  }

  function dense(input, layer, activate) {
    var weight = layer.weight;
    var bias = layer.bias;
    var output = new Array(bias.length);
    for (var j = 0; j < bias.length; j++) {
      var value = bias[j];
      for (var i = 0; i < input.length; i++) {
        value += input[i] * weight[i][j];
      }
      output[j] = activate ? silu(value) : value;
    }
    return output;
  }

  function validatePayload(payload) {
    if (!payload || payload.format !== "cartpole-diffusion-tiny-mlp-v1") {
      throw new Error("Unsupported denoiser payload");
    }
    if (!Array.isArray(payload.weights) || payload.weights.length !== 3) {
      throw new Error("Expected a three-layer MLP");
    }
    return payload;
  }

  function fromJSON(payload) {
    payload = validatePayload(payload);
    var stateScale = payload.normalization.state_scale;
    var embedDim = payload.diffusion.timestep_embedding_dim;
    var totalSteps = payload.diffusion.timesteps;

    function features(noisyAction, timestep, state) {
      if (noisyAction.length !== 16 || state.length !== 4) {
        throw new Error("Expected action[16] and state[4]");
      }
      var normalizedState = state.map(function (value, i) {
        return value / stateScale[i];
      });
      return noisyAction
        .slice()
        .concat(normalizedState)
        .concat(timestepEmbedding(timestep, embedDim, totalSteps));
    }

    function predict(noisyAction, timestep, state) {
      var x = features(noisyAction, timestep, state);
      x = dense(x, payload.weights[0], true);
      x = dense(x, payload.weights[1], true);
      return dense(x, payload.weights[2], false);
    }

    return {
      metadata: payload,
      predict: predict,
      features: features,
    };
  }

  async function load(url) {
    var response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to load denoiser weights: HTTP " + response.status);
    }
    return fromJSON(await response.json());
  }

  var api = {
    fromJSON: fromJSON,
    load: load,
    timestepEmbedding: timestepEmbedding,
  };

  root.CartPoleTinyDenoiser = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
