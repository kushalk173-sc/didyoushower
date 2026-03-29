/**
 * Client-side checks for exported attestations (same canonicalization as fabric-runtime).
 * This is not a "ZK proof" verifier — commitments here are SHA-256 bindings with revealed nonce.
 */
(function (global) {
  "use strict";

  const encoder = new TextEncoder();

  function canonicalize(value) {
    if (value === undefined) return "null";
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return "[" + value.map((item) => canonicalize(item)).join(",") + "]";
    }
    const keys = Object.keys(value).sort();
    return "{" + keys.map((key) => JSON.stringify(key) + ":" + canonicalize(value[key])).join(",") + "}";
  }

  function toBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlToUint8(s) {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function sha256Base64Url(input) {
    if (!global.crypto || !global.crypto.subtle) {
      throw new Error("Web Crypto unavailable");
    }
    const digest = await global.crypto.subtle.digest("SHA-256", encoder.encode(String(input)));
    return toBase64Url(digest);
  }

  async function verifyBindingCommitment(zk) {
    if (!zk || !zk.commitment || !zk.nonce || !zk.committedAt) {
      return {
        name: "Binding commitment (SHA-256)",
        pass: false,
        detail: "Missing zk.commitment / nonce / committedAt",
      };
    }
    const witness = "dry|" + zk.committedAt + "|" + zk.nonce;
    const check = await sha256Base64Url(witness);
    const pass = check === zk.commitment;
    return {
      name: "Binding commitment (SHA-256)",
      pass,
      detail: pass
        ? "SHA-256(dry|ISO8601|nonce) matches commitment"
        : "Expected " + zk.commitment + ", got " + check,
    };
  }

  async function verifyAttestationDigest(body, signing) {
    const canonical = canonicalize(body);
    const digest = await sha256Base64Url(canonical);
    const pass = digest === signing.attestationDigest;
    return {
      name: "Canonical body digest",
      pass,
      detail: pass
        ? "SHA-256(canonical JSON) matches signing.attestationDigest"
        : "Digest mismatch (file tampered or wrong schema)",
    };
  }

  async function verifyEcdsaSignature(body, signing) {
    const sig = signing.signature || "";
    if (sig.indexOf("soft.") === 0) {
      return {
        name: "ECDSA (P-256) signature",
        pass: true,
        detail: "Soft mode — no asymmetric signature (browser had no key material)",
      };
    }
    if (!signing.publicJwk || !global.crypto || !global.crypto.subtle) {
      return {
        name: "ECDSA (P-256) signature",
        pass: false,
        detail: "Missing public Jwk or Web Crypto",
      };
    }
    try {
      const canonical = canonicalize(body);
      const publicKey = await global.crypto.subtle.importKey(
        "jwk",
        signing.publicJwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      );
      const sigBytes = base64UrlToUint8(sig);
      const ok = await global.crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        sigBytes,
        encoder.encode(canonical)
      );
      return {
        name: "ECDSA (P-256) signature",
        pass: ok,
        detail: ok ? "Signature verifies over canonical body bytes" : "Signature invalid",
      };
    } catch (e) {
      return {
        name: "ECDSA (P-256) signature",
        pass: false,
        detail: (e && e.message) || String(e),
      };
    }
  }

  function verifyGpuPresent(body) {
    const g = body.gpu;
    if (!g || !g.hash) {
      return {
        name: "WebGPU attestation hash",
        pass: true,
        detail: "Not present (GPU unavailable or skipped) — optional field",
      };
    }
    return {
      name: "WebGPU attestation hash",
      pass: true,
      detail: "Present (" + (g.algorithm || "unknown") + ") — recompute not performed in this verifier",
    };
  }

  function verifyWebAuthnNote() {
    return {
      name: "WebAuthn",
      pass: true,
      detail:
        "Assertions are not verified here — that requires your relying party server and stored credentials.",
    };
  }

  /** @returns {{ ok: boolean, results: Array<{name: string, pass: boolean, detail: string}> }} */
  async function verifyAttestation(attestation) {
    if (!attestation || !attestation.body || !attestation.signing) {
      return {
        ok: false,
        results: [{ name: "Structure", pass: false, detail: "Expected { body, signing }" }],
      };
    }

    // Slim presentation credential (from QR scan)
    if (attestation._isPresentation) {
      return verifyPresentation(attestation);
    }

    // Full attestation (from exported JSON)
    const body = attestation.body;
    const signing = attestation.signing;
    const results = [];

    if (body.zk) {
      results.push(await verifyBindingCommitment(body.zk));
    } else {
      results.push({ name: "Binding commitment (SHA-256)", pass: false, detail: "No body.zk — export may be old or incomplete" });
    }

    results.push(await verifyAttestationDigest(body, signing));
    results.push(await verifyEcdsaSignature(body, signing));
    results.push(verifyGpuPresent(body));
    results.push(verifyWebAuthnNote());

    const critical = results.filter((r) => r.name.indexOf("WebAuthn") === -1 && r.name.indexOf("WebGPU") === -1);
    const ok = critical.every((r) => r.pass);
    return { ok, results };
  }

  async function verifyPresentation(pres) {
    const body = pres.body;
    const signing = pres.signing;
    const results = [];

    // 1. Schema check
    results.push({
      name: "Credential schema",
      pass: body.schema === "yhack.dryness.presentation/v1",
      detail: body.schema === "yhack.dryness.presentation/v1"
        ? "yhack.dryness.presentation/v1"
        : "Unexpected schema: " + (body.schema || "missing"),
    });

    // 2. ZK commitment display (no nonce in presentation — just show it was present)
    results.push({
      name: "ZK Binding Commitment",
      pass: Boolean(body.zkCommitment),
      detail: body.zkCommitment
        ? "Present: " + body.zkCommitment.slice(0, 24) + "… (full verification requires exported JSON)"
        : "Not present in this credential",
    });

    // 3. ECDSA signature over presentation body
    const sig = String(signing.signature || "");
    if (sig.indexOf("soft.") === 0) {
      results.push({ name: "ECDSA Signature (P-256)", pass: true, detail: "Soft mode — no asymmetric key material" });
    } else if (!signing.publicJwk || !global.crypto || !global.crypto.subtle) {
      results.push({ name: "ECDSA Signature (P-256)", pass: false, detail: "Missing public JWK or Web Crypto" });
    } else {
      try {
        const canonical = canonicalize(body);
        const pubKey = await global.crypto.subtle.importKey(
          "jwk", signing.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
        );
        const ok = await global.crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          pubKey,
          base64UrlToUint8(sig),
          encoder.encode(canonical)
        );
        results.push({
          name: "ECDSA Signature (P-256)",
          pass: ok,
          detail: ok ? "Signature valid over canonical presentation body" : "Signature invalid",
        });
      } catch (e) {
        results.push({ name: "ECDSA Signature (P-256)", pass: false, detail: (e && e.message) || String(e) });
      }
    }

    // 4. Witness tier
    results.push({
      name: "Witness tier",
      pass: true,
      detail: body.witnessTier === "device_bound"
        ? "Device-bound — WebAuthn assertion was completed on the issuing device"
        : "Session-scoped — no hardware authenticator",
    });

    const ok = results.filter((r) => r.name !== "ZK Binding Commitment").every((r) => r.pass);
    return { ok, results };
  }

  function digestToDemoAnchorHex(attestation) {
    try {
      const c = canonicalize(attestation.body);
      return global.crypto.subtle
        ? global.crypto.subtle.digest("SHA-256", encoder.encode(c)).then((buf) => {
            return Array.from(new Uint8Array(buf))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
          })
        : Promise.resolve("");
    } catch {
      return Promise.resolve("");
    }
  }

  /**
   * Compact portable bundle for QR / URL fragment: full attestation body + signing material.
   * ECDSA verifies over canonicalize(body) — same bytes as fabric-runtime signing.
   */
  function verificationBundleFromAttestation(attestation) {
    if (!attestation || !attestation.body || !attestation.signing) {
      throw new Error("Expected full attestation { body, signing }");
    }
    return {
      v: 1,
      b: attestation.body,
      s: attestation.signing.signature,
      j: attestation.signing.publicJwk,
      i: attestation.signing.keyId,
      a: attestation.signing.algorithm,
    };
  }

  async function attestationFromVerificationBundle(bundle) {
    if (!bundle || bundle.v !== 1 || !bundle.b) {
      throw new Error("Unsupported verification bundle");
    }
    const digest = await sha256Base64Url(canonicalize(bundle.b));
    return {
      body: bundle.b,
      signing: {
        signature: bundle.s,
        publicJwk: bundle.j,
        keyId: bundle.i,
        algorithm: bundle.a,
        attestationDigest: digest,
      },
    };
  }

  async function encodeVerificationBundle(attestation) {
    const bundle = verificationBundleFromAttestation(attestation);
    const json = JSON.stringify(bundle);
    if (typeof CompressionStream !== "undefined") {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate"));
      const buf = await new Response(stream).arrayBuffer();
      return "z1." + toBase64Url(buf);
    }
    return "j1." + toBase64Url(encoder.encode(json));
  }

  async function decodeVerificationToken(token) {
    const t = String(token || "").trim();
    if (!t) throw new Error("Empty token");

    // p1. — deflate-compressed slim presentation (v2 bundle)
    if (t.indexOf("p1.") === 0) {
      if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream unavailable");
      const raw = base64UrlToUint8(t.slice(3));
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate"));
      const buf = await new Response(stream).arrayBuffer();
      const bundle = JSON.parse(new TextDecoder().decode(buf));
      return presentationFromBundle(bundle);
    }

    // p1j. — uncompressed slim presentation fallback
    if (t.indexOf("p1j.") === 0) {
      const bundle = JSON.parse(new TextDecoder().decode(base64UrlToUint8(t.slice(4))));
      return presentationFromBundle(bundle);
    }

    // Legacy full-attestation tokens
    let json;
    if (t.indexOf("z1.") === 0) {
      if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream unavailable");
      const raw = base64UrlToUint8(t.slice(3));
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate"));
      const buf = await new Response(stream).arrayBuffer();
      json = new TextDecoder().decode(buf);
    } else if (t.indexOf("j1.") === 0) {
      json = new TextDecoder().decode(base64UrlToUint8(t.slice(3)));
    } else {
      throw new Error("Unknown token prefix");
    }
    const bundle = JSON.parse(json);
    return attestationFromVerificationBundle(bundle);
  }

  // Convert a v2 presentation bundle into a verifiable object
  async function presentationFromBundle(bundle) {
    if (!bundle || bundle.v !== 2 || !bundle.b) throw new Error("Invalid presentation bundle");
    const digest = await sha256Base64Url(canonicalize(bundle.b));
    return {
      _isPresentation: true,
      body: bundle.b,
      signing: {
        signature: bundle.s,
        publicJwk: bundle.j,
        keyId: bundle.j ? (await sha256Base64Url(canonicalize(bundle.j))).slice(0, 22) : "soft-sign",
        algorithm: "ECDSA-P256-SHA256",
        presentationDigest: digest,
      },
    };
  }

  function buildVerifyFragmentUrl(verifyPageUrl, token) {
    const u = new URL(verifyPageUrl, typeof location !== "undefined" ? location.href : "https://local/");
    u.hash = "t=" + encodeURIComponent(token);
    return u.href;
  }

  global.HydrationAttestationVerify = {
    verifyAttestation,
    digestToDemoAnchorHex,
    canonicalize,
    encodeVerificationBundle,
    decodeVerificationToken,
    verificationBundleFromAttestation,
    attestationFromVerificationBundle,
    buildVerifyFragmentUrl,
  };
})(typeof window !== "undefined" ? window : globalThis);
