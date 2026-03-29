(() => {
  "use strict";

  if (window.__drynessFabricV2) {
    return;
  }
  window.__drynessFabricV2 = true;

  const DB_NAME = "hydrationComplianceSuite";
  const DB_VERSION = 3;
  const EVENTS_STORE = "events";
  const META_STORE = "meta";
  const META_LEDGER_HEAD = "ledgerHead";
  const META_LEDGER_COUNT = "ledgerCount";
  const META_SIGNING_KEY = "signingKey";
  const META_PROOF_CHAIN = "proofChain";
  const META_OPERATOR_ALIAS = "operatorAlias";
  const COUNCIL_CHANNEL = "tide-council-v3";
  const LOCAL_ALIAS_KEY = "drynessOperatorAlias";
  const HEARTBEAT_MS = 2400;
  const PEER_TTL_MS = 7000;
  const CONSENSUS_WAIT_MS = 520;
  const encoder = new TextEncoder();
  const pageStartedAt = Date.now();
  const nodeId = makeId("node");
  let operatorAlias = loadOperatorAlias();
  let nodeLabel = formatNodeLabel(operatorAlias);

  const tideLevels = [
    "Band I — nominal",
    "Band II — low variance",
    "Band III — elevated",
    "Band IV — stable",
    "Band V — within tolerance",
  ];

  const oracleLines = [
    { t: "Insufficient context to determine a definitive classification. Consider providing additional detail.", c: 91 },
    { t: "The available inputs do not strongly favor a single outcome. Results should be validated manually.", c: 87 },
    { t: "Pattern confidence is moderate. Recommend reviewing related records before taking action.", c: 84 },
    { t: "No anomaly detected beyond normal variance for this session.", c: 79 },
    { t: "Estimated alignment with the stated policy framework is within expected bounds.", c: 93 },
    { t: "Further corroboration may be required for high-risk decisions.", c: 88 },
    { t: "Processing complete. No additional automated recommendations at this time.", c: 76 },
  ];

  let storageMode = "memory";
  let auditHead = "genesis";
  let auditCount = 0;
  let auditEvents = [];
  let memoryLedger = [];
  let dbPromise = null;
  let keyMaterialPromise = null;
  let activeCertificate = null;
  let activeAttestation = null;
  let lastConsensus = null;
  let lastVerdict = "pending";
  let proofChain = [];
  let currentProofBlock = null;
  let workerInstance = null;
  let workerState = "cold";
  let workerSeq = 0;
  let processingVerdict = false;
  let serviceWorkerState = "inactive";
  let toastTimer = null;

  // ── Advanced systems state ─────────────────────────────────────────
  let zkNonce = null;
  let zkCommitmentDigest = null;
  let opfsWorker = null;
  let opfsState = "cold";
  let opfsPending = new Map();
  let opfsSeq = 0;
  let lastOpfsAppendTotal = null;
  let gpuDevice = null;
  let gpuState = "cold";
  let biometricState = "cold";
  let locksState = "cold";
  const crdtRegister = { value: null, timestamp: 0, vectorClock: {} };

  const workerPending = new Map();
  const peers = new Map();
  const pendingConsensus = new Map();
  const councilSupported = "BroadcastChannel" in window;
  const councilChannel = councilSupported ? new BroadcastChannel(COUNCIL_CHANNEL) : null;

  const controls = {
    btnYes: rewireControl("btnYes"),
    btnNo: rewireControl("btnNo"),
    resetDisq: rewireControl("resetDisq"),
    resetOk: rewireControl("resetOk"),
    downloadCert: rewireControl("downloadCert"),
    regenCert: rewireControl("regenCert"),
    btnChain: rewireControl("btnChain"),
    btnCsv: rewireControl("btnCsv"),
    downloadAttestation: rewireControl("downloadAttestation"),
    runAttestationChecks: rewireControl("runAttestationChecks"),
    openVerifier: rewireControl("openVerifier"),
    chainAnchor: rewireControl("chainAnchor"),
    exportAudit: rewireControl("exportAudit"),
    replayAudit: rewireControl("replayAudit"),
    randomizeAlias: rewireControl("randomizeAlias"),
    exportChain: rewireControl("exportChain"),
  };

  const choices = document.getElementById("choices");
  const resultDisq = document.getElementById("resultDisq");
  const resultOk = document.getElementById("resultOk");
  const qrDisq = document.getElementById("qrDisq");
  const qrOk = document.getElementById("qrOk");
  const certTimestamp = document.getElementById("certTimestamp");
  const certSeal = document.getElementById("certSeal");
  const certOperator = document.getElementById("certOperator");
  const certTide = document.getElementById("certTide");
  const certCouncil = document.getElementById("certCouncil");
  const certSignature = document.getElementById("certSignature");
  const toastEl = document.getElementById("toast");
  const chainBackdrop = document.getElementById("chainBackdrop");
  const chainSpinner = document.getElementById("chainSpinner");
  const chainStatus = document.getElementById("chainStatus");
  const chainClose = document.getElementById("chainClose");
  const oracleBtn = document.getElementById("oracleBtn");
  const oracleQ = document.getElementById("oracleQ");
  const oracleOut = document.getElementById("oracleOut");

  const meshLed = document.getElementById("meshLed");
  const cryptoLed = document.getElementById("cryptoLed");
  const auditLed = document.getElementById("auditLed");
  const nodeIdLabel = document.getElementById("nodeIdLabel");
  const operatorAliasInput = document.getElementById("operatorAliasInput");
  const quorumSummary = document.getElementById("quorumSummary");
  const consensusSummary = document.getElementById("consensusSummary");
  const peerList = document.getElementById("peerList");
  const publicKeyId = document.getElementById("publicKeyId");
  const signatureDigest = document.getElementById("signatureDigest");
  const swStatus = document.getElementById("swStatus");
  const ledgerSummary = document.getElementById("ledgerSummary");
  const ledgerHead = document.getElementById("ledgerHead");
  const workerSummary = document.getElementById("workerSummary");
  const runtimeCaps = document.getElementById("runtimeCaps");
  const auditList = document.getElementById("auditList");
  const chainLed = document.getElementById("chainLed");
  const chainSummary = document.getElementById("chainSummary");
  const chainHead = document.getElementById("chainHead");
  const chainMode = document.getElementById("chainMode");
  const chainExplorerList = document.getElementById("chainExplorerList");

  // Advanced systems DOM refs
  const zkLed = document.getElementById("zkLed");
  const zkCommitmentDisplay = document.getElementById("zkCommitmentDisplay");
  const biometricLed = document.getElementById("biometricLed");
  const biometricStatus = document.getElementById("biometricStatus");
  const gpuLed = document.getElementById("gpuLed");
  const gpuStatus = document.getElementById("gpuStatus");
  const opfsLed = document.getElementById("opfsLed");
  const opfsStatus = document.getElementById("opfsStatus");
  const locksLed = document.getElementById("locksLed");
  const crdtLed = document.getElementById("crdtLed");
  const crdtVectorDisplay = document.getElementById("crdtVectorDisplay");
  const certZk = document.getElementById("certZk");
  const certWitness = document.getElementById("certWitness");
  const certGpuFingerprint = document.getElementById("certGpuFingerprint");
  const witnessLine = document.getElementById("witnessLine");

  applyOperatorAlias(operatorAlias);
  renderPeerList();
  renderRuntimeCaps();
  renderAuditList();
  renderChainExplorer();
  syncVerificationControls();

  controls.btnYes.addEventListener("click", () => {
    void handleWetChoice();
  });
  controls.btnNo.addEventListener("click", () => {
    void handleDryChoice();
  });
  controls.resetDisq.addEventListener("click", hideAll);
  controls.resetOk.addEventListener("click", hideAll);
  controls.downloadCert.addEventListener("click", () => {
    if (!activeCertificate || !activeAttestation) {
      showToast("No attestation available — complete a compliant session first");
      return;
    }
    downloadCertificateFile();
    showToast("Attestation record downloaded");
  });
  controls.regenCert.addEventListener("click", () => {
    void regenerateCertificate();
  });
  controls.btnChain.addEventListener("click", () => {
    void showLedgerProof();
  });
  controls.btnCsv.addEventListener("click", exportVerdictCsv);
  controls.downloadAttestation.addEventListener("click", () => {
    void downloadAttestationFile();
  });
  controls.runAttestationChecks.addEventListener("click", () => {
    void showAttestationVerifyResults();
  });
  controls.openVerifier.addEventListener("click", () => {
    if (!activeAttestation) {
      showToast("No attestation available — complete a compliant session first");
      return;
    }
    try {
      const json = JSON.stringify(activeAttestation);
      sessionStorage.setItem("hydration_pending_verify", json);
      window.open("verify.html", "_blank", "noopener,noreferrer");
      showToast("Verifier opened — attestation pre-filled");
    } catch (err) {
      console.error(err);
      showToast("Could not open verifier");
    }
  });
  controls.chainAnchor.addEventListener("click", () => {
    void (async () => {
      if (!activeAttestation) {
        showToast("No attestation available — complete a compliant session first");
        return;
      }
      if (!window.HydrationChainAnchor) {
        showToast("Chain scripts not loaded");
        return;
      }
      const cfg = window.HYDRATION_CHAIN_CONFIG || {};
      if (!cfg.contractAddress) {
        showToast("Set contractAddress in chain-config.js");
        return;
      }
      try {
        showToast("Confirm in wallet…");
        const res = await window.HydrationChainAnchor.anchorAttestation(activeAttestation);
        await appendAuditEvent("chain.anchor", {
          txHash: res.hash,
          sealNumber: activeAttestation.body.certificate.sealNumber,
        });
        showToast("Anchored: " + res.hash.slice(0, 12) + "…");
      } catch (err) {
        console.error(err);
        showToast((err && err.message) || "Anchor failed");
      }
    })();
  });
  controls.exportAudit.addEventListener("click", () => {
    void exportAuditLedger();
  });
  controls.replayAudit.addEventListener("click", () => {
    void replayAuditLedger();
  });
  controls.randomizeAlias.addEventListener("click", () => {
    void rotateOperatorAlias();
  });
  controls.exportChain.addEventListener("click", () => {
    void exportProofChain();
  });
  operatorAliasInput.addEventListener("change", () => {
    void updateOperatorAlias(operatorAliasInput.value);
  });
  operatorAliasInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      operatorAliasInput.blur();
    }
  });

  chainClose.addEventListener("click", () => {
    chainBackdrop.classList.add("hidden");
  });

  oracleBtn.addEventListener("click", () => {
    const line = oracleLines[Math.floor(Math.random() * oracleLines.length)];
    const q = oracleQ.value.trim();
    const prefix = q
      ? "<p style=\"margin:0 0 0.5rem;font-size:0.82rem;opacity:0.85\">Context: <em>" +
        escapeHtml(q.length > 120 ? q.slice(0, 120) + "..." : q) +
        "</em></p>"
      : "";
    oracleOut.innerHTML =
      prefix +
      "<p style=\"margin:0\">" +
      escapeHtml(line.t) +
      "</p><span class=\"conf\">Model confidence: " +
      line.c +
      "%</span>";
    oracleOut.classList.remove("hidden");
  });

  if (councilChannel) {
    councilChannel.addEventListener("message", (event) => {
      void handleCouncilMessage(event.data);
    });
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.type === "service-worker.ready") {
        serviceWorkerState = "cached shell";
        renderRuntimeCaps();
        syncChainStatus();
      }
      if (data.type === "service-worker.status") {
        serviceWorkerState = "cache " + data.assetCount;
        renderRuntimeCaps();
        syncChainStatus();
      }
    });
  }

  window.addEventListener("beforeunload", () => {
    broadcastPresence("presence.goodbye");
  });

  void warmRuntime();

  function rewireControl(id) {
    const original = document.getElementById(id);
    const clone = original.cloneNode(true);
    original.replaceWith(clone);
    return clone;
  }

  function loadOperatorAlias() {
    try {
      const stored = localStorage.getItem(LOCAL_ALIAS_KEY);
      if (stored) {
        return sanitizeAlias(stored);
      }
    } catch (error) {
      console.error(error);
    }
    return makeOperatorAlias(nodeId);
  }

  async function hydrateOperatorIdentity() {
    let stored = null;
    try {
      stored = await metaGet(META_OPERATOR_ALIAS);
    } catch (error) {
      console.error(error);
    }
    applyOperatorAlias(stored || operatorAlias);
    await persistOperatorAlias(operatorAlias);
  }

  function applyOperatorAlias(nextAlias) {
    const alias = sanitizeAlias(nextAlias || operatorAlias);
    operatorAlias = alias;
    nodeLabel = formatNodeLabel(alias);
    nodeIdLabel.textContent = nodeLabel;
    operatorAliasInput.value = alias;
    if (!activeCertificate) {
      certOperator.textContent = alias;
    }
  }

  async function persistOperatorAlias(alias) {
    try {
      localStorage.setItem(LOCAL_ALIAS_KEY, alias);
    } catch (error) {
      console.error(error);
    }
    try {
      await metaSet(META_OPERATOR_ALIAS, alias);
    } catch (error) {
      console.error(error);
    }
  }

  async function updateOperatorAlias(nextAlias, options = {}) {
    const alias = sanitizeAlias(nextAlias || operatorAlias);
    const changed = alias !== operatorAlias;
    applyOperatorAlias(alias);
    renderPeerList();
    renderRuntimeCaps();
    renderChainExplorer();
    if (!changed) {
      return false;
    }
    await persistOperatorAlias(alias);
    if (options.broadcast !== false) {
      broadcastPresence("presence.heartbeat");
    }
    if (options.audit !== false) {
      await appendAuditEvent("identity.alias_updated", {
        alias,
        nodeLabel,
      });
    }
    if (activeCertificate && options.toast !== false) {
      showToast("Alias updated. Regenerate attestation to apply.");
    } else if (options.toast !== false) {
      showToast("Operator alias updated");
    }
    return true;
  }

  async function rotateOperatorAlias() {
    const nextAlias = makeOperatorAlias(makeId("alias"));
    operatorAliasInput.value = nextAlias;
    await updateOperatorAlias(nextAlias, {
      toast: true,
    });
  }

  function broadcastPresence(type) {
    if (!councilChannel) return;
    councilChannel.postMessage({
      type,
      nodeId,
      label: nodeLabel,
      alias: operatorAlias,
      ts: Date.now(),
    });
  }

  async function warmRuntime() {
    setupWorker();
    await hydrateLedger();
    await hydrateOperatorIdentity();
    setupCouncil();
    await ensureProofChain();
    await ensureSigningKeys();
    await registerServiceWorker();
    await initZkWitness();
    setupOpfsWorker();
    void initGpu();
    initWebLocks();
    await appendAuditEvent("runtime.booted", {
      nodeId,
      nodeLabel,
      operatorAlias,
      council: councilSupported ? "mesh" : "solo",
      worker: workerState,
      storageMode,
    });
    hydrateChainAnchorUi();
  }

  function hideAll() {
    resultDisq.classList.remove("visible");
    resultOk.classList.remove("visible");
    choices.style.display = "flex";
    clearVerificationArtifacts({ keepConsensus: false });
    setChoiceLock(false);
  }

  function setChoiceLock(locked) {
    controls.btnYes.disabled = locked;
    controls.btnNo.disabled = locked;
  }

  function syncVerificationControls() {
    const hasProof = Boolean(activeCertificate && activeAttestation);
    const cfg = window.HYDRATION_CHAIN_CONFIG || {};
    const chainReady = Boolean(cfg.contractAddress);
    controls.downloadCert.disabled = !hasProof;
    controls.downloadAttestation.disabled = !hasProof;
    controls.runAttestationChecks.disabled = !hasProof;
    controls.openVerifier.disabled = !hasProof;
    controls.chainAnchor.disabled = !hasProof || !chainReady;
    controls.btnChain.disabled = !hasProof;
    controls.regenCert.disabled = !lastConsensus;
  }

  function hydrateChainAnchorUi() {
    const cfg = window.HYDRATION_CHAIN_CONFIG || {};
    const addrEl = document.getElementById("chainAnchorContract");
    const netEl = document.getElementById("chainAnchorNetwork");
    const led = document.getElementById("chainAnchorLed");
    if (addrEl) {
      addrEl.textContent = cfg.contractAddress || "—";
    }
    if (netEl) {
      netEl.textContent = cfg.networkLabel || (cfg.chainId != null ? "chain " + String(cfg.chainId) : "—");
    }
    if (led) {
      if (cfg.contractAddress) {
        led.textContent = "configured";
        led.className = "status-led hot";
      } else {
        led.textContent = "not configured";
        led.className = "status-led warn";
      }
    }
    syncVerificationControls();
  }

  function clearVerificationArtifacts(options = {}) {
    activeCertificate = null;
    activeAttestation = null;
    currentProofBlock = null;
    if (!options.keepConsensus) {
      lastConsensus = null;
    }
    certTimestamp.textContent = "Pending review";
    certSeal.textContent = "YH-DRY-000000";
    certOperator.textContent = operatorAlias;
    certTide.textContent = "Pending";
    certCouncil.textContent = "Awaiting quorum";
    certSignature.textContent = "Pending signature";
    signatureDigest.textContent = "pending";
    if (certZk) certZk.textContent = "Pending";
    if (certWitness) certWitness.textContent = "—";
    if (certGpuFingerprint) certGpuFingerprint.textContent = "—";
    if (witnessLine) {
      witnessLine.textContent = "";
      witnessLine.hidden = true;
    }
    clearIssuanceEvidencePanels();
    syncChainStatus();
    syncVerificationControls();
  }

  function clearIssuanceEvidencePanels() {
    const certBox = document.getElementById("issuanceEvidence");
    const certList = document.getElementById("issuanceEvidenceList");
    const disqBox = document.getElementById("issuanceEvidenceDisq");
    const disqList = document.getElementById("issuanceEvidenceListDisq");
    if (certBox) certBox.hidden = true;
    if (certList) certList.innerHTML = "";
    if (disqBox) disqBox.hidden = true;
    if (disqList) disqList.innerHTML = "";
  }

  function renderIssuanceEvidenceList(items, listEl) {
    if (!listEl) return;
    listEl.innerHTML = items
      .map((row) => {
        const cls = row.tone === "ok" ? "ok" : row.tone === "skip" ? "skip" : "";
        return (
          "<li" +
          (cls ? ' class="' + cls + '"' : "") +
          ">" +
          escapeHtml(row.text) +
          "</li>"
        );
      })
      .join("");
  }

  function renderIssuanceEvidenceCert(evidence) {
    const box = document.getElementById("issuanceEvidence");
    const list = document.getElementById("issuanceEvidenceList");
    if (!box || !list || !evidence) return;
    const items = [];
    if (evidence.webLock) {
      let lockMsg = "Web Lock: acquired " + (evidence.webLock.name || "hydration.verdict.lock") + " (single-flight).";
      if (!evidence.webLock.used) {
        lockMsg =
          evidence.crdt && evidence.crdt.verdict === "regenerated"
            ? "Web Lock: not used (regenerate runs outside the verdict mutex)."
            : "Web Lock: API missing — no mutex.";
      }
      items.push({
        tone: evidence.webLock.used ? "ok" : "skip",
        text: lockMsg,
      });
    }
    if (evidence.commitment) {
      const c = evidence.commitment;
      items.push({
        tone: c.selfCheckOk ? "ok" : "skip",
        text:
          "Binding commitment: " +
          (c.digestShort || "") +
          " at " +
          (c.committedAt || "") +
          (c.selfCheckOk ? " (SHA-256 self-check passed)." : " (self-check failed — see console)."),
      });
    }
    if (evidence.webauthn) {
      const w = evidence.webauthn;
      items.push({
        tone: w.tier === "device_bound" ? "ok" : "skip",
        text:
          "WebAuthn: " +
          (w.tier === "device_bound" ? "device-bound (" + (w.state || "verified") + ")." : "session-only (" + (w.state || "skipped") + ")."),
      });
    }
    if (evidence.webgpu) {
      items.push({
        tone: "ok",
        text:
          "WebGPU: attestation hash computed (" +
          (evidence.webgpu.algorithm || "wgsl") +
          ") — " +
          (evidence.webgpu.hashPrefix || "") +
          "…",
      });
    } else {
      items.push({
        tone: "skip",
        text: "WebGPU: no GPU hash on attestation (GPU unavailable or compute skipped).",
      });
    }
    if (evidence.opfs) {
      const o = evidence.opfs;
      items.push({
        tone: o.state === "live" ? "ok" : "skip",
        text:
          "OPFS: " +
          (o.state === "live"
            ? "append wrote to hydration-audit.ndjson (file now " + (o.ledgerBytes != null ? o.ledgerBytes + " B" : "unknown size") + ")."
            : "not live (" + String(o.state) + ") — no NDJSON mirror."),
      });
    }
    if (evidence.crdt) {
      items.push({
        tone: "ok",
        text: "CRDT: verdict broadcast on council channel (" + String(evidence.crdt.verdict || "") + ").",
      });
    }
    renderIssuanceEvidenceList(items, list);
    box.hidden = false;
  }

  function renderIssuanceEvidenceDisq(evidence) {
    const box = document.getElementById("issuanceEvidenceDisq");
    const list = document.getElementById("issuanceEvidenceListDisq");
    if (!box || !list || !evidence) return;
    const items = [];
    if (evidence.webLock) {
      items.push({
        tone: evidence.webLock.used ? "ok" : "skip",
        text: evidence.webLock.used
          ? "Web Lock: acquired " + (evidence.webLock.name || "hydration.verdict.lock") + "."
          : "Web Lock: unavailable.",
      });
    }
    items.push({ tone: "skip", text: "Binding commitment / WebAuthn / WebGPU: not part of disqualification path." });
    if (evidence.opfs) {
      const o = evidence.opfs;
      items.push({
        tone: o.state === "live" ? "ok" : "skip",
        text:
          "OPFS: " +
          (o.state === "live"
            ? "audit line appended (" + (o.ledgerBytes != null ? o.ledgerBytes + " B" : "size n/a") + ")."
            : "not live (" + String(o.state) + ")."),
      });
    }
    if (evidence.crdt) {
      items.push({
        tone: "ok",
        text: "CRDT: broadcast " + String(evidence.crdt.verdict || "disqualified") + ".",
      });
    }
    renderIssuanceEvidenceList(items, list);
    box.hidden = false;
  }

  async function handleWetChoice() {
    if (processingVerdict) return;
    processingVerdict = true;
    setChoiceLock(true);

    const run = async () => {
      try {
        await updateOperatorAlias(operatorAliasInput.value, {
          audit: false,
          toast: false,
        });
        clearVerificationArtifacts({ keepConsensus: false });
        resultOk.classList.remove("visible");
        resultDisq.classList.add("visible");
        choices.style.display = "none";
        lastVerdict = "disqualified";
        lastConsensus = null;
        crdtWrite("disqualified");
        setQr(qrDisq, {
          verdict: "disqualified",
          ts: new Date().toISOString(),
          nodeId,
          operatorAlias,
          meta: "session",
        });
        quorumSummary.textContent = "0 / 0 dry votes";
        consensusSummary.textContent = "Recorded: disqualification";
        setLed(meshLed, councilSupported ? "mesh witness" : "solo witness", councilSupported ? "hot" : "warn");
        await appendAuditEvent("verdict.disqualified", {
          reason: "self_reported_shower",
          nodeId,
          operatorAlias,
          evidence: {
            webLock: { used: "locks" in navigator, name: "hydration.verdict.lock" },
            crdt: { broadcast: true, verdict: "disqualified" },
            opfs: { state: opfsState },
          },
        });
        renderIssuanceEvidenceDisq({
          webLock: { used: "locks" in navigator, name: "hydration.verdict.lock" },
          crdt: { broadcast: true, verdict: "disqualified" },
          opfs: { state: opfsState, ledgerBytes: lastOpfsAppendTotal },
        });
        showToast("Result recorded in audit log");
      } finally {
        processingVerdict = false;
        setChoiceLock(false);
      }
    };

    if ("locks" in navigator) {
      setLed(locksLed, "acquiring lock", "cold");
      await navigator.locks.request("hydration.verdict.lock", async () => {
        setLed(locksLed, "lock held", "hot");
        await run();
        setLed(locksLed, "lock released", "cold");
      });
    } else {
      await run();
    }
  }

  async function handleDryChoice() {
    if (processingVerdict) return;
    processingVerdict = true;
    setChoiceLock(true);

    const run = async () => {
      try {
        await updateOperatorAlias(operatorAliasInput.value, {
          audit: false,
          toast: false,
        });
        clearVerificationArtifacts({ keepConsensus: true });
        consensusSummary.textContent = "Awaiting peer consensus";
        quorumSummary.textContent = "Collecting votes";
        setLed(meshLed, "forming quorum", "cold");
        setLed(cryptoLed, "arming key", "cold");
        showToast("Requesting consensus");

        const zkCommitTs = new Date().toISOString();
        const zkProof = await buildZkCommitment("dry", zkCommitTs);

        const consensus = await requestCouncilConsensus("dry");
        const certificate = createCertificate(consensus);
        const webAuthnAssertion = await attemptWebAuthnAssertion(
          await sha256Base64Url("dry|" + certificate.sealNumber)
        );
        const attestation = await buildAttestation(certificate, consensus, { zkProof, webAuthnAssertion });
        const commitmentOk = await verifyCommitmentProof(zkProof);
        if (!commitmentOk) {
          console.warn("binding commitment self-check failed");
        }
        activeCertificate = certificate;
        activeAttestation = attestation;
        updateCertificateUi();
        syncVerificationControls();
        resultDisq.classList.remove("visible");
        resultOk.classList.add("visible");
        choices.style.display = "none";
        lastVerdict = "certified_not_showered";
        crdtWrite("certified_not_showered");
        const evidenceBase = {
          webLock: { used: "locks" in navigator, name: "hydration.verdict.lock" },
          commitment: {
            committedAt: zkProof.committedAt,
            digestShort: shortHash(zkProof.commitment, 20),
            selfCheckOk: commitmentOk,
          },
          webauthn: {
            tier: webAuthnAssertion ? "device_bound" : "session_only",
            state: biometricState,
          },
          webgpu: attestation.body.gpu
            ? {
                algorithm: attestation.body.gpu.algorithm,
                hashPrefix: attestation.body.gpu.hash.slice(0, 16),
              }
            : null,
          crdt: { broadcast: true, verdict: "certified_not_showered" },
        };
        await appendAuditEvent("certificate.issued", {
          sealNumber: certificate.sealNumber,
          operatorAlias: certificate.operatorAlias,
          digest: shortHash(attestation.signing.attestationDigest, 20),
          dryScore: certificate.modelScore,
          approvals: consensus.approvals,
          totalVotes: consensus.totalVotes,
          bindingCommitment: shortHash(zkProof.commitment, 16),
          biometric: webAuthnAssertion ? webAuthnAssertion.authenticatorAttachment : "skipped",
          witnessTier: webAuthnAssertion ? "device_bound" : "session_only",
          evidence: {
            ...evidenceBase,
            opfs: { state: opfsState },
          },
        });
        renderIssuanceEvidenceCert({
          ...evidenceBase,
          opfs: { state: opfsState, ledgerBytes: lastOpfsAppendTotal },
        });
        showToast("Attestation issued");
      } catch (error) {
        console.error(error);
        clearVerificationArtifacts({ keepConsensus: false });
        showToast("Consensus unavailable; please retry");
        consensusSummary.textContent = "Consensus fault";
        setLed(meshLed, "faulted", "warn");
      } finally {
        processingVerdict = false;
        setChoiceLock(false);
      }
    };

    if ("locks" in navigator) {
      setLed(locksLed, "acquiring lock", "cold");
      await navigator.locks.request("hydration.verdict.lock", async () => {
        setLed(locksLed, "lock held", "hot");
        await run();
        setLed(locksLed, "lock released", "cold");
      });
    } else {
      await run();
    }
  }

  async function regenerateCertificate() {
    if (!lastConsensus) {
      showToast("No quorum state to reuse yet");
      return;
    }
    if (processingVerdict) return;
    processingVerdict = true;
    setChoiceLock(true);
    setLed(cryptoLed, "resealing", "cold");

    try {
      const zkProof = await buildZkCommitment("dry", new Date().toISOString());
      const certificate = createCertificate(lastConsensus);
      const webAuthnAssertion = await attemptWebAuthnAssertion(
        await sha256Base64Url("dry|" + certificate.sealNumber)
      );
      const attestation = await buildAttestation(certificate, lastConsensus, { zkProof, webAuthnAssertion });
      const commitmentOk = await verifyCommitmentProof(zkProof);
      activeCertificate = certificate;
      activeAttestation = attestation;
      updateCertificateUi();
      syncVerificationControls();
      const evidenceBase = {
        webLock: { used: false, name: "hydration.verdict.lock" },
        commitment: {
          committedAt: zkProof.committedAt,
          digestShort: shortHash(zkProof.commitment, 20),
          selfCheckOk: commitmentOk,
        },
        webauthn: {
          tier: webAuthnAssertion ? "device_bound" : "session_only",
          state: biometricState,
        },
        webgpu: attestation.body.gpu
          ? {
              algorithm: attestation.body.gpu.algorithm,
              hashPrefix: attestation.body.gpu.hash.slice(0, 16),
            }
          : null,
        crdt: { broadcast: false, verdict: "regenerated" },
      };
      await appendAuditEvent("certificate.regenerated", {
        sealNumber: certificate.sealNumber,
        operatorAlias: certificate.operatorAlias,
        digest: shortHash(attestation.signing.attestationDigest, 20),
        evidence: {
          ...evidenceBase,
          opfs: { state: opfsState },
        },
      });
      renderIssuanceEvidenceCert({
        ...evidenceBase,
        opfs: { state: opfsState, ledgerBytes: lastOpfsAppendTotal },
      });
      showToast("Attestation updated: " + certificate.sealNumber);
    } finally {
      processingVerdict = false;
      setChoiceLock(false);
    }
  }

  function createCertificate(consensus) {
    const issuedAt = new Date();
    const sealNumber =
      "YH-" +
      nodeLabel.slice(-4).toUpperCase() +
      "-" +
      Date.now().toString(36).toUpperCase() +
      "-" +
      Math.floor(1000 + Math.random() * 9000);
    const tideIndex = Math.min(
      tideLevels.length - 1,
      Math.max(0, Math.floor(consensus.evaluation.dryScore * tideLevels.length))
    );

    return {
      issuedAtIso: issuedAt.toISOString(),
      timestampLabel: new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(issuedAt),
      sealNumber,
      operatorAlias,
      tideLevel: tideLevels[tideIndex],
      councilSummary: consensus.approvals + " / " + consensus.threshold + " dry votes",
      signatureDigest: "pending",
      modelScore: Number(consensus.evaluation.dryScore.toFixed(6)),
      confidence: consensus.evaluation.confidence,
      councilDigest: consensus.councilDigest,
    };
  }

  async function buildAttestation(certificate, consensus, extras = {}) {
    const keys = await ensureSigningKeys();
    const body = {
      schema: "yhack.dryness.attestation/v8",
      node: {
        nodeId,
        label: nodeLabel,
        alias: operatorAlias,
      },
      certificate: {
        issuedAtIso: certificate.issuedAtIso,
        sealNumber: certificate.sealNumber,
        operatorAlias: certificate.operatorAlias,
        tideLevel: certificate.tideLevel,
        councilSummary: certificate.councilSummary,
        modelScore: certificate.modelScore,
        confidence: certificate.confidence,
      },
      consensus: {
        requestId: consensus.requestId,
        threshold: consensus.threshold,
        approvals: consensus.approvals,
        totalVotes: consensus.totalVotes,
        digest: consensus.councilDigest,
        votes: consensus.votes.map((vote) => ({
          nodeId: vote.nodeId,
          label: vote.label,
          approve: vote.approve,
          confidence: vote.confidence,
          dryScore: Number(vote.dryScore.toFixed(6)),
        })),
      },
      ledger: {
        storageMode,
        head: auditHead,
        count: auditCount,
      },
      runtime: {
        workerState,
        serviceWorkerState,
        councilMode: councilSupported ? "mesh" : "solo",
        pageOrigin: location.origin || "file",
      },
      zk: extras.zkProof || null,
      biometric: extras.webAuthnAssertion || null,
      witnessTier: extras.webAuthnAssertion ? "device_bound" : "session_only",
      gpu: null,
    };

    // GPU hash of the canonical attestation body
    const canonicalBody = canonicalize(body);
    body.gpu = await gpuHashPayload(canonicalBody);

    const canonicalBodyFinal = canonicalize(body);
    const attestationDigest = await sha256Base64Url(canonicalBodyFinal);
    let signature = "soft." + attestationDigest;

    if (keys.privateKey && window.crypto && window.crypto.subtle) {
      const signatureBuffer = await window.crypto.subtle.sign(
        {
          name: "ECDSA",
          hash: "SHA-256",
        },
        keys.privateKey,
        encoder.encode(canonicalBodyFinal)
      );
      signature = toBase64Url(signatureBuffer);
    }

    certificate.signatureDigest = attestationDigest;
    publicKeyId.textContent = keys.keyId;
    signatureDigest.textContent = shortHash(attestationDigest, 26);
    certSignature.textContent = shortHash(attestationDigest, 26);
    setLed(cryptoLed, keys.privateKey ? "signature sealed" : "soft sealed", keys.privateKey ? "hot" : "warn");

    return {
      body,
      signing: {
        keyId: keys.keyId,
        algorithm: keys.algorithm,
        signature,
        attestationDigest,
        publicJwk: keys.publicJwk,
      },
    };
  }

  function updateCertificateUi() {
    if (!activeCertificate || !activeAttestation) return;
    certTimestamp.textContent = activeCertificate.timestampLabel;
    certSeal.textContent = activeCertificate.sealNumber;
    certOperator.textContent = activeCertificate.operatorAlias;
    certTide.textContent = activeCertificate.tideLevel;
    certCouncil.textContent = activeCertificate.councilSummary;
    certSignature.textContent = shortHash(activeCertificate.signatureDigest, 26);
    currentProofBlock = findProofBlock(activeAttestation.signing.attestationDigest);
    syncChainStatus();
    const body = activeAttestation.body;
    let verifyPageHref = "verify.html";
    try {
      verifyPageHref = new URL("verify.html", location.href).href;
    } catch (_) {}
    void (async () => {
      let qrPayload = "";
      try {
        if (window.HydrationAttestationVerify && window.HydrationAttestationVerify.encodeVerificationBundle) {
          const token = await window.HydrationAttestationVerify.encodeVerificationBundle(activeAttestation);
          qrPayload =
            window.HydrationAttestationVerify.buildVerifyFragmentUrl(verifyPageHref, token);
        }
      } catch (err) {
        console.warn("verification QR bundle failed", err);
      }
      if (qrPayload) {
        try {
          await renderQrImg(qrOk, qrPayload, { width: 240, errorCorrectionLevel: "M" });
        } catch (err) {
          console.warn("QR render failed", err);
          setQr(qrOk, {
            verdict: "certified_not_showered",
            sealNumber: activeCertificate.sealNumber,
            operatorAlias: activeCertificate.operatorAlias,
            digest: activeAttestation.signing.attestationDigest,
            council: activeCertificate.councilSummary,
            modelScore: activeCertificate.modelScore,
            witness: body.biometric ? "device_bound" : "session_only",
            commitment: body.zk && body.zk.commitment ? shortHash(body.zk.commitment, 16) : null,
            gpuFingerprint: body.gpu && body.gpu.hash ? body.gpu.hash.slice(0, 16) : null,
            verifyPage: verifyPageHref,
          });
        }
      } else {
        setQr(qrOk, {
          verdict: "certified_not_showered",
          sealNumber: activeCertificate.sealNumber,
          operatorAlias: activeCertificate.operatorAlias,
          digest: activeAttestation.signing.attestationDigest,
          council: activeCertificate.councilSummary,
          modelScore: activeCertificate.modelScore,
          witness: body.biometric ? "device_bound" : "session_only",
          commitment: body.zk && body.zk.commitment ? shortHash(body.zk.commitment, 16) : null,
          gpuFingerprint: body.gpu && body.gpu.hash ? body.gpu.hash.slice(0, 16) : null,
          verifyPage: verifyPageHref,
        });
      }
    })();
    if (certWitness) {
      certWitness.textContent = body.biometric
        ? "Device-bound (WebAuthn assertion)"
        : "Session-scoped (no WebAuthn)";
    }
    if (certGpuFingerprint) {
      const g = body.gpu;
      certGpuFingerprint.textContent = g && g.hash ? g.hash.slice(0, 22) + "…" : "—";
    }
    if (certZk && body.zk && body.zk.commitment) {
      certZk.textContent = shortHash(body.zk.commitment, 20);
    }
    const certIssuerEl = document.getElementById("certIssuer");
    if (certIssuerEl) {
      certIssuerEl.textContent = (location.origin && location.origin !== "null")
        ? location.origin
        : "https://yhack-tide-pool.vercel.app";
    }
    if (witnessLine) {
      witnessLine.hidden = false;
      witnessLine.textContent = body.biometric
        ? "Authenticator: WebAuthn assertion bound to this device (user-present verification)."
        : "Authenticator: not completed — attestation is session-scoped only.";
    }
  }

  function downloadCertificateFile() {
    const blob = new Blob([buildCertificateSvg(activeCertificate, activeAttestation)], {
      type: "image/svg+xml",
    });
    downloadBlob(blob, activeCertificate.sealNumber.toLowerCase() + "-attestation.svg");
  }

  async function showAttestationVerifyResults() {
    if (!activeAttestation) {
      showToast("No attestation available — complete a compliant session first");
      return;
    }
    if (!window.HydrationAttestationVerify) {
      showToast("Verifier script not loaded");
      return;
    }
    chainBackdrop.classList.remove("hidden");
    chainSpinner.classList.remove("hidden");
    chainStatus.textContent = "Running cryptographic checks…";
    try {
      const { ok, results } = await window.HydrationAttestationVerify.verifyAttestation(activeAttestation);
      chainSpinner.classList.add("hidden");
      const list = results
        .map(
          (r) =>
            "<li><strong>" +
            escapeHtml(r.name) +
            "</strong> — " +
            (r.pass ? "pass" : "fail") +
            "<br><span style=\"opacity:0.85;font-size:0.88rem\">" +
            escapeHtml(r.detail) +
            "</span></li>"
        )
        .join("");
      chainStatus.innerHTML =
        "<p style=\"margin:0 0 0.5rem;font-weight:800;color:" +
        (ok ? "#0d6b4c" : "#b91c1c") +
        "\">" +
        (ok ? "All critical checks passed." : "Some checks failed — see below.") +
        '</p><ul style="margin:0;padding-left:1.2rem;text-align:left;line-height:1.45">' +
        list +
        "</ul>";
    } catch (err) {
      chainSpinner.classList.add("hidden");
      chainStatus.textContent = (err && err.message) || String(err);
    }
  }

  async function downloadAttestationFile() {
    if (!activeAttestation) {
      showToast("No attestation available — complete a compliant session first");
      return;
    }
    const blob = new Blob([JSON.stringify(activeAttestation, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    downloadBlob(blob, activeCertificate.sealNumber.toLowerCase() + ".session-attestation.json");
    await appendAuditEvent("attestation.downloaded", {
      sealNumber: activeCertificate.sealNumber,
    });
    showToast("Attestation exported");
  }

  function buildCertificateSvg(certificate, attestation) {
    const verifyOrigin = (location.origin && location.origin !== "null")
      ? location.origin
      : "https://yhack-tide-pool.vercel.app";
    const verifyUrl = verifyOrigin + "/verify.html";
    const witnessTier = attestation.body.witnessTier === "device_bound" ? "Device-bound (WebAuthn)" : "Session only";
    const zkShort = attestation.body.zk && attestation.body.zk.commitment
      ? shortHash(attestation.body.zk.commitment, 24)
      : "—";
    const gpuShort = attestation.body.gpu && attestation.body.gpu.hash
      ? attestation.body.gpu.hash.slice(0, 20) + "…"
      : "—";
    const sigShort = attestation.signing.signature && attestation.signing.signature.indexOf("soft.") !== 0
      ? shortHash(attestation.signing.attestationDigest, 32)
      : "(soft mode)";

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="860" viewBox="0 0 1200 860" role="img" aria-labelledby="svgTitle svgDesc">
  <title id="svgTitle">Hydration Compliance Suite — Credential Attestation</title>
  <desc id="svgDesc">ECDSA-P256-SHA256 signed attestation. Verify at ${escapeXml(verifyUrl)}</desc>
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f0fbff"/>
      <stop offset="100%" stop-color="#d8eef8"/>
    </linearGradient>
    <linearGradient id="headGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0a3d62"/>
      <stop offset="60%" stop-color="#0a4d68"/>
      <stop offset="100%" stop-color="#0c5278"/>
    </linearGradient>
    <linearGradient id="stripe" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#088395"/>
      <stop offset="50%" stop-color="#5eead4"/>
      <stop offset="100%" stop-color="#7dd3fc"/>
    </linearGradient>
  </defs>

  <!-- Outer frame -->
  <rect width="1200" height="860" fill="#e8f8fc"/>
  <rect x="24" y="24" width="1152" height="812" rx="28" fill="#ffffff" stroke="#0a4d68" stroke-width="3"/>

  <!-- Header band -->
  <rect x="24" y="24" width="1152" height="130" rx="28" fill="url(#headGrad)"/>
  <rect x="24" y="120" width="1152" height="34" fill="url(#headGrad)"/>

  <!-- Colour stripe -->
  <rect x="24" y="148" width="1152" height="8" fill="url(#stripe)"/>

  <!-- Header text -->
  <text x="64" y="72" font-family="Inter, Nunito, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="5" fill="rgba(255,255,255,0.55)">HYDRATION COMPLIANCE SUITE · CREDENTIAL ATTESTATION</text>
  <text x="64" y="122" font-family="Inter, Nunito, Arial, sans-serif" font-size="38" font-weight="800" fill="#ffffff">CERTIFIED NOT SHOWERED</text>

  <!-- Seal badge (top-right circle) -->
  <circle cx="1090" cy="88" r="72" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="8"/>
  <circle cx="1090" cy="88" r="58" fill="none" stroke="rgba(94,234,212,0.45)" stroke-width="3" stroke-dasharray="6 10"/>
  <text x="1090" y="76" text-anchor="middle" font-family="Inter, Nunito, Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="3" fill="rgba(255,255,255,0.65)">STATUS</text>
  <text x="1090" y="104" text-anchor="middle" font-family="Inter, Nunito, Arial, sans-serif" font-size="22" font-weight="800" fill="#ffffff">CLEAR</text>

  <!-- Body background -->
  <rect x="48" y="172" width="1104" height="648" rx="18" fill="url(#bgGrad)" stroke="#bde7f2" stroke-width="1.5"/>

  <!-- ── Left column: Credential fields ── -->
  <!-- Timestamp -->
  <rect x="68" y="196" width="520" height="82" rx="14" fill="#ffffff" stroke="#d0eaf5" stroke-width="1.5"/>
  <text x="92" y="222" font-family="Inter, Nunito, Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="3.5" fill="#5a8a9c">TIMESTAMP</text>
  <text x="92" y="256" font-family="Inter, Nunito, Arial, sans-serif" font-size="26" font-weight="700" fill="#0a4d68">${escapeXml(certificate.timestampLabel)}</text>

  <!-- Seal -->
  <rect x="68" y="292" width="520" height="82" rx="14" fill="#ffffff" stroke="#d0eaf5" stroke-width="1.5"/>
  <text x="92" y="318" font-family="Inter, Nunito, Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="3.5" fill="#5a8a9c">SEAL NUMBER</text>
  <text x="92" y="352" font-family="Inter, Nunito, Arial, sans-serif" font-size="26" font-weight="700" fill="#0a4d68">${escapeXml(certificate.sealNumber)}</text>

  <!-- Holder -->
  <rect x="68" y="388" width="520" height="82" rx="14" fill="#ffffff" stroke="#d0eaf5" stroke-width="1.5"/>
  <text x="92" y="414" font-family="Inter, Nunito, Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="3.5" fill="#5a8a9c">HOLDER (OPERATOR ALIAS)</text>
  <text x="92" y="448" font-family="Inter, Nunito, Arial, sans-serif" font-size="26" font-weight="700" fill="#0a4d68">${escapeXml(certificate.operatorAlias)}</text>

  <!-- Assessment band -->
  <rect x="68" y="484" width="246" height="72" rx="14" fill="#ffffff" stroke="#d0eaf5" stroke-width="1.5"/>
  <text x="92" y="508" font-family="Inter, Nunito, Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="3.5" fill="#5a8a9c">ASSESSMENT BAND</text>
  <text x="92" y="540" font-family="Inter, Nunito, Arial, sans-serif" font-size="22" font-weight="700" fill="#0a4d68">${escapeXml(certificate.tideLevel)}</text>

  <!-- Witness tier -->
  <rect x="326" y="484" width="262" height="72" rx="14" fill="#ffffff" stroke="#d0eaf5" stroke-width="1.5"/>
  <text x="350" y="508" font-family="Inter, Nunito, Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="3.5" fill="#5a8a9c">WITNESS TIER</text>
  <text x="350" y="540" font-family="Inter, Nunito, Arial, sans-serif" font-size="19" font-weight="700" fill="${attestation.body.witnessTier === "device_bound" ? "#5b21b6" : "#374151"}">${escapeXml(witnessTier)}</text>

  <!-- ── Right column: Cryptographic details ── -->
  <text x="632" y="218" font-family="Inter, Nunito, Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="3" fill="#5a8a9c">CRYPTOGRAPHIC PROOF</text>

  <text x="632" y="250" font-family="Inter, Nunito, Arial, sans-serif" font-size="12" font-weight="700" fill="#4a7a8c">Algorithm</text>
  <text x="800" y="250" font-family="Inter, Nunito, Arial, sans-serif" font-size="12" fill="#0a4d68">ECDSA-P256-SHA256</text>

  <text x="632" y="278" font-family="Inter, Nunito, Arial, sans-serif" font-size="12" font-weight="700" fill="#4a7a8c">Key ID</text>
  <text x="800" y="278" font-family="ui-monospace, Courier, monospace" font-size="11" fill="#0a4d68">${escapeXml(shortHash(attestation.signing.keyId || "", 28))}</text>

  <text x="632" y="306" font-family="Inter, Nunito, Arial, sans-serif" font-size="12" font-weight="700" fill="#4a7a8c">Digest</text>
  <text x="800" y="306" font-family="ui-monospace, Courier, monospace" font-size="11" fill="#0a4d68">${escapeXml(sigShort)}</text>

  <text x="632" y="334" font-family="Inter, Nunito, Arial, sans-serif" font-size="12" font-weight="700" fill="#4a7a8c">ZK Commitment</text>
  <text x="800" y="334" font-family="ui-monospace, Courier, monospace" font-size="11" fill="#0a4d68">${escapeXml(zkShort)}</text>

  <text x="632" y="362" font-family="Inter, Nunito, Arial, sans-serif" font-size="12" font-weight="700" fill="#4a7a8c">GPU Hash</text>
  <text x="800" y="362" font-family="ui-monospace, Courier, monospace" font-size="11" fill="#0a4d68">${escapeXml(gpuShort)}</text>

  <text x="632" y="390" font-family="Inter, Nunito, Arial, sans-serif" font-size="12" font-weight="700" fill="#4a7a8c">Council</text>
  <text x="800" y="390" font-family="Inter, Nunito, Arial, sans-serif" font-size="12" fill="#0a4d68">${escapeXml(certificate.councilSummary)}</text>

  <text x="632" y="418" font-family="Inter, Nunito, Arial, sans-serif" font-size="12" font-weight="700" fill="#4a7a8c">Model Score</text>
  <text x="800" y="418" font-family="Inter, Nunito, Arial, sans-serif" font-size="12" fill="#0a4d68">${escapeXml(String(certificate.modelScore))}</text>

  <text x="632" y="446" font-family="Inter, Nunito, Arial, sans-serif" font-size="12" font-weight="700" fill="#4a7a8c">Ledger Head</text>
  <text x="800" y="446" font-family="ui-monospace, Courier, monospace" font-size="11" fill="#0a4d68">${escapeXml(shortHash(auditHead, 28))}</text>

  <text x="632" y="474" font-family="Inter, Nunito, Arial, sans-serif" font-size="12" font-weight="700" fill="#4a7a8c">Issuer</text>
  <text x="800" y="474" font-family="Inter, Nunito, Arial, sans-serif" font-size="11" fill="#0a4d68">${escapeXml(verifyOrigin)}</text>

  <!-- Divider -->
  <line x1="48" y1="572" x2="1152" y2="572" stroke="#d0eaf5" stroke-width="1.5"/>

  <!-- Verify strip -->
  <rect x="48" y="584" width="1104" height="72" rx="14" fill="#f0faff" stroke="#bde7f2" stroke-width="1.5"/>
  <text x="76" y="610" font-family="Inter, Nunito, Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="3" fill="#088395">VERIFICATION INSTRUCTIONS</text>
  <text x="76" y="637" font-family="Inter, Nunito, Arial, sans-serif" font-size="13" fill="#0a4d68">Scan the in-app QR code or paste the exported session-attestation.json at:</text>
  <text x="76" y="655" font-family="ui-monospace, Courier, monospace" font-size="13" font-weight="600" fill="#0a4d68">${escapeXml(verifyUrl)}</text>

  <!-- Divider -->
  <line x1="48" y1="672" x2="1152" y2="672" stroke="#d0eaf5" stroke-width="1"/>

  <!-- Footer -->
  <text x="68" y="696" font-family="Inter, Nunito, Arial, sans-serif" font-size="12" fill="#5a8a9c">Issued: ${escapeXml(certificate.issuedAtIso)}</text>
  <text x="68" y="718" font-family="Inter, Nunito, Arial, sans-serif" font-size="11" fill="#8aabbb">Credential type: HydrationComplianceCredential · Schema: yhack.dryness.attestation/v8</text>
  <text x="68" y="738" font-family="Inter, Nunito, Arial, sans-serif" font-size="11" fill="#8aabbb">ECDSA signature over canonical JSON body — independently verifiable offline using Web Crypto (SubtleCrypto.verify).</text>
  <text x="68" y="758" font-family="Inter, Nunito, Arial, sans-serif" font-size="10" fill="#aac8d8">Not a government, legal, or professionally-accredited credential. For informational purposes only.</text>
</svg>`;
  }

  async function requestCouncilConsensus(verdict) {
    const requestId = makeId("quorum");
    const payload = {
      verdict,
      seed: requestId,
      hesitationMs: Date.now() - pageStartedAt,
      peerCount: peers.size + 1,
      nodeId,
      workerSeq: workerSeq + 1,
    };
    const evaluation = await runWorkerJob("evaluate", payload);
    const threshold = Math.max(1, Math.min(3, peers.size + 1));
    const selfVote = {
      nodeId,
      label: nodeLabel,
      approve: evaluation.dryScore >= 0.36,
      confidence: evaluation.confidence,
      dryScore: evaluation.dryScore,
    };
    const state = {
      threshold,
      votes: new Map([[nodeId, selfVote]]),
      resolver: null,
      timer: null,
    };

    await appendAuditEvent("consensus.requested", {
      requestId,
      threshold,
      peerCount: peers.size + 1,
      dryScore: Number(evaluation.dryScore.toFixed(6)),
    });

    const resultPromise = new Promise((resolve) => {
      state.resolver = resolve;
      state.timer = setTimeout(() => {
        void finalizeConsensus(requestId);
      }, CONSENSUS_WAIT_MS);
    });

    pendingConsensus.set(requestId, state);

    if (councilChannel) {
      councilChannel.postMessage({
        type: "consensus.request",
        nodeId,
        label: nodeLabel,
        requestId,
        payload,
      });
    }

    if (state.votes.size >= threshold) {
      void finalizeConsensus(requestId);
    }

    const result = await resultPromise;
    result.evaluation = evaluation;
    lastConsensus = result;
    updateConsensusUi(result);
    return result;
  }

  async function finalizeConsensus(requestId) {
    const state = pendingConsensus.get(requestId);
    if (!state) return;
    pendingConsensus.delete(requestId);
    clearTimeout(state.timer);

    const votes = Array.from(state.votes.values()).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    const approvals = votes.filter((vote) => vote.approve).length;
    const totalVotes = votes.length;
    const approved = approvals >= Math.floor(totalVotes / 2) + 1;
    const councilDigest = await sha256Base64Url(
      canonicalize({
        requestId,
        threshold: state.threshold,
        votes: votes.map((vote) => ({
          nodeId: vote.nodeId,
          approve: vote.approve,
          confidence: vote.confidence,
          dryScore: Number(vote.dryScore.toFixed(6)),
        })),
      })
    );

    await appendAuditEvent("consensus.closed", {
      requestId,
      approvals,
      totalVotes,
      threshold: state.threshold,
      digest: shortHash(councilDigest, 16),
    });

    state.resolver({
      requestId,
      threshold: state.threshold,
      approvals,
      totalVotes,
      approved,
      votes,
      councilDigest,
    });
  }

  function updateConsensusUi(consensus) {
    quorumSummary.textContent = consensus.approvals + " / " + consensus.threshold + " dry votes";
    consensusSummary.textContent =
      (consensus.approved ? "Approved" : "Split vote") +
      " via " +
      shortHash(consensus.councilDigest, 16);
    setLed(meshLed, consensus.approved ? "quorum reached" : "split vote", consensus.approved ? "hot" : "warn");
    renderPeerList();
  }

  function setupCouncil() {
    if (!councilSupported) {
      setLed(meshLed, "solo tab", "warn");
      renderRuntimeCaps();
      return;
    }

    broadcastPresence("presence.hello");

    setInterval(() => {
      broadcastPresence("presence.heartbeat");
    }, HEARTBEAT_MS);

    setInterval(() => {
      const now = Date.now();
      let changed = false;
      peers.forEach((peer, peerId) => {
        if (now - peer.seenAt > PEER_TTL_MS) {
          peers.delete(peerId);
          changed = true;
        }
      });
      if (changed) {
        renderPeerList();
      }
    }, 1500);

    setLed(meshLed, "mesh online", "hot");
    renderRuntimeCaps();
  }

  async function handleCouncilMessage(message) {
    if (!message || message.nodeId === nodeId) return;

    if (message.type === "presence.hello" || message.type === "presence.heartbeat") {
      peers.set(message.nodeId, {
        nodeId: message.nodeId,
        label: message.label || message.alias || "peer",
        seenAt: Date.now(),
      });
      renderPeerList();
      if (message.type === "presence.hello") {
        broadcastPresence("presence.heartbeat");
      }
      return;
    }

    if (message.type === "presence.goodbye") {
      peers.delete(message.nodeId);
      renderPeerList();
      return;
    }

    if (message.type === "consensus.request") {
      peers.set(message.nodeId, {
        nodeId: message.nodeId,
        label: message.label || message.alias || "peer",
        seenAt: Date.now(),
      });
      renderPeerList();
      const evaluation = await runWorkerJob("evaluate", {
        verdict: message.payload.verdict,
        seed: message.requestId + ":" + nodeId,
        hesitationMs: message.payload.hesitationMs,
        peerCount: peers.size + 1,
        nodeId,
        workerSeq: workerSeq + 1,
      });
      councilChannel.postMessage({
        type: "consensus.vote",
        requestId: message.requestId,
        nodeId,
        label: nodeLabel,
        vote: {
          approve: evaluation.dryScore >= 0.36,
          confidence: evaluation.confidence,
          dryScore: evaluation.dryScore,
        },
      });
      return;
    }

    if (message.type === "consensus.vote") {
      const state = pendingConsensus.get(message.requestId);
      if (!state) return;
      state.votes.set(message.nodeId, {
        nodeId: message.nodeId,
        label: message.label || "peer",
        approve: Boolean(message.vote && message.vote.approve),
        confidence: Number((message.vote && message.vote.confidence) || 0),
        dryScore: Number((message.vote && message.vote.dryScore) || 0),
      });
      peers.set(message.nodeId, {
        nodeId: message.nodeId,
        label: message.label || message.alias || "peer",
        seenAt: Date.now(),
      });
      renderPeerList();
      if (state.votes.size >= state.threshold) {
        void finalizeConsensus(message.requestId);
      }
    }

    if (message.type === "crdt.sync") {
      crdtMerge(message);
    }
  }

  function renderPeerList() {
    const pills = ['<span class="fabric-pill local">self ' + escapeHtml(nodeLabel) + "</span>"];
    Array.from(peers.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((peer) => {
        pills.push('<span class="fabric-pill">' + escapeHtml(peer.label) + "</span>");
      });

    if (!peers.size) {
      pills.push('<span class="fabric-pill warn">solo quorum</span>');
    }

    peerList.innerHTML = pills.join("");
  }

  function setupWorker() {
    if (!("Worker" in window)) {
      workerState = "inline fallback";
      workerSummary.textContent = "worker inline fallback";
      renderRuntimeCaps();
      return;
    }

    try {
      workerInstance = new Worker(new URL("./tide-worker.js", window.location.href));
      workerState = "online";
      workerSummary.textContent = "worker online";
      workerInstance.addEventListener("message", (event) => {
        const data = event.data || {};
        const pending = workerPending.get(data.id);
        if (!pending) return;
        workerPending.delete(data.id);
        if (data.error) {
          pending.reject(new Error(data.error));
          return;
        }
        pending.resolve(data.result);
      });
      workerInstance.addEventListener("error", () => {
        workerState = "faulted";
        workerSummary.textContent = "worker faulted";
        renderRuntimeCaps();
      });
    } catch (error) {
      console.error(error);
      workerState = "inline fallback";
      workerSummary.textContent = "worker inline fallback";
    }

    renderRuntimeCaps();
  }

  function runWorkerJob(type, payload) {
    if (!workerInstance) {
      return Promise.resolve(runWorkerFallback(type, payload));
    }

    workerSeq += 1;
    const id = "job-" + workerSeq;
    return new Promise((resolve, reject) => {
      workerPending.set(id, { resolve, reject });
      workerInstance.postMessage({
        id,
        type,
        payload,
      });
    });
  }

  function runWorkerFallback(type, payload) {
    if (type === "evaluate") {
      const peerFactor = Math.min(0.14, (payload.peerCount || 1) * 0.02);
      const hesitation = Math.min(1, (payload.hesitationMs || 0) / 8000);
      const dryScore = Math.min(0.99, 0.62 + peerFactor + hesitation * 0.05);
      return {
        dryScore: Number(dryScore.toFixed(6)),
        confidence: 91,
        bucket: "dry",
        vector: [0.71, 0.83, 0.77, 0.68],
        entropy: 0.581,
        phase: "fallback",
      };
    }

    if (type === "replay") {
      return {
        count: Array.isArray(payload.events) ? payload.events.length : 0,
        entropy: 0.5,
        verdict: "Replay complete via inline fallback",
        digest: shortHash(makeId("replay"), 24),
      };
    }

    if (type === "mineBlock") {
      const block = {
        index: payload.index || 0,
        ts: new Date().toISOString(),
        prevHash: payload.prevHash || "0".repeat(64),
        difficulty: Math.max(1, Math.min(5, payload.difficulty || 3)),
        nonce: 0,
        miner: payload.miner || nodeLabel,
        payload: payload.payload || {},
      };
      const prefix = "0".repeat(block.difficulty);
      let hash = computeToyBlockHash(block);
      while (!hash.startsWith(prefix)) {
        block.nonce += 1;
        hash = computeToyBlockHash(block);
      }
      block.hash = hash;
      return block;
    }

    return {};
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      serviceWorkerState = "unsupported";
      renderRuntimeCaps();
      syncChainStatus();
      return;
    }

    if (location.protocol === "file:") {
      serviceWorkerState = "file protocol blocked";
      renderRuntimeCaps();
      syncChainStatus();
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register(new URL("./sw.js", window.location.href));
      serviceWorkerState = registration.active ? "active" : "installing";
      renderRuntimeCaps();
      syncChainStatus();
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "cache-status",
        });
      }
    } catch (error) {
      console.error(error);
      serviceWorkerState = "registration failed";
      renderRuntimeCaps();
      syncChainStatus();
    }
  }

  async function ensureSigningKeys() {
    if (keyMaterialPromise) {
      return keyMaterialPromise;
    }

    keyMaterialPromise = (async () => {
      if (!(window.crypto && window.crypto.subtle)) {
        publicKeyId.textContent = "soft-sign";
        setLed(cryptoLed, "soft sign", "warn");
        return {
          privateKey: null,
          publicKey: null,
          publicJwk: null,
          keyId: "soft-sign",
          algorithm: "decorative-sha",
        };
      }

      try {
        const stored = await metaGet(META_SIGNING_KEY);
        if (stored && stored.publicJwk && stored.privateJwk) {
          const privateKey = await window.crypto.subtle.importKey(
            "jwk",
            stored.privateJwk,
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["sign"]
          );
          const publicKey = await window.crypto.subtle.importKey(
            "jwk",
            stored.publicJwk,
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["verify"]
          );
          publicKeyId.textContent = stored.keyId;
          setLed(cryptoLed, "key loaded", "hot");
          return {
            privateKey,
            publicKey,
            publicJwk: stored.publicJwk,
            keyId: stored.keyId,
            algorithm: "ECDSA-P256-SHA256",
          };
        }
      } catch (error) {
        console.error(error);
      }

      const pair = await window.crypto.subtle.generateKey(
        {
          name: "ECDSA",
          namedCurve: "P-256",
        },
        true,
        ["sign", "verify"]
      );
      const publicJwk = await window.crypto.subtle.exportKey("jwk", pair.publicKey);
      const privateJwk = await window.crypto.subtle.exportKey("jwk", pair.privateKey);
      const keyId = (await sha256Base64Url(canonicalize(publicJwk))).slice(0, 22);

      try {
        await metaSet(META_SIGNING_KEY, {
          keyId,
          publicJwk,
          privateJwk,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error(error);
      }

      publicKeyId.textContent = keyId;
      setLed(cryptoLed, "key generated", "hot");
      return {
        privateKey: pair.privateKey,
        publicKey: pair.publicKey,
        publicJwk,
        keyId,
        algorithm: "ECDSA-P256-SHA256",
      };
    })();

    return keyMaterialPromise;
  }

  async function hydrateLedger() {
    try {
      storageMode = "indexeddb";
      auditHead = (await metaGet(META_LEDGER_HEAD)) || "genesis";
      auditCount = Number((await metaGet(META_LEDGER_COUNT)) || 0);
      auditEvents = await loadRecentEvents(8);
      setLed(auditLed, "ledger live", "hot");
    } catch (error) {
      console.error(error);
      storageMode = "memory";
      auditHead = "volatile";
      auditCount = memoryLedger.length;
      auditEvents = memoryLedger.slice(0, 8);
      setLed(auditLed, "volatile", "warn");
    }
    renderAuditList();
    renderRuntimeCaps();
  }

  async function appendAuditEvent(type, data) {
    const prevHash = auditHead || "genesis";
    const event = {
      id: makeId("evt"),
      type,
      ts: new Date().toISOString(),
      nodeId,
      data,
      prevHash,
    };
    event.hash = await sha256Base64Url(
      canonicalize({
        type: event.type,
        ts: event.ts,
        nodeId: event.nodeId,
        data: event.data,
        prevHash: event.prevHash,
      })
    );

    try {
      const db = await getDb();
      const tx = db.transaction([EVENTS_STORE, META_STORE], "readwrite");
      tx.objectStore(EVENTS_STORE).put(event);
      tx.objectStore(META_STORE).put({
        key: META_LEDGER_HEAD,
        value: event.hash,
      });
      tx.objectStore(META_STORE).put({
        key: META_LEDGER_COUNT,
        value: auditCount + 1,
      });
      await txComplete(tx);
      storageMode = "indexeddb";
    } catch (error) {
      console.error(error);
      storageMode = "memory";
      memoryLedger.unshift(event);
    }

    auditHead = event.hash;
    auditCount += 1;
    auditEvents.unshift(event);
    auditEvents = auditEvents.slice(0, 8);
    await opfsAppend(event);
    renderAuditList();
    renderRuntimeCaps();
    return event;
  }

  function renderAuditList() {
    ledgerSummary.textContent = auditCount + " events / " + storageMode;
    ledgerHead.textContent = "head " + shortHash(auditHead, 22);
    workerSummary.textContent = "worker " + workerState;

    if (!auditEvents.length) {
      auditList.innerHTML = '<div class="audit-empty">No audit events recorded yet.</div>';
      return;
    }

    auditList.innerHTML = auditEvents
      .map((event) => {
        return (
          '<article class="audit-item">' +
          '<div class="audit-top"><span class="audit-type">' +
          escapeHtml(event.type) +
          '</span><span class="audit-hash mono">' +
          escapeHtml(shortHash(event.hash, 18)) +
          "</span></div>" +
          '<div class="audit-body">' +
          escapeHtml(event.ts) +
          " :: " +
          escapeHtml(previewData(event.data)) +
          "</div></article>"
        );
      })
      .join("");
  }

  function renderRuntimeCaps() {
    const caps = [
      { label: storageMode === "indexeddb" ? "idb live" : "memory ledger", tone: storageMode === "indexeddb" ? "" : "warn" },
      { label: councilSupported ? "broadcast mesh" : "solo tab", tone: councilSupported ? "" : "warn" },
      { label: window.crypto && window.crypto.subtle ? "webcrypto" : "soft sign", tone: window.crypto && window.crypto.subtle ? "" : "warn" },
      { label: "worker " + workerState, tone: workerState === "online" ? "" : "warn" },
      { label: "chain h" + Math.max(0, proofChain.length - 1), tone: proofChain.length > 0 ? "" : "warn" },
      {
        label: location.protocol === "file:" ? "sw blocked on file" : "sw " + serviceWorkerState,
        tone: serviceWorkerState === "active" || serviceWorkerState === "cached shell" ? "" : "warn",
      },
      { label: "commit " + (zkNonce ? "armed" : "cold"), tone: zkNonce ? "" : "warn" },
      { label: "opfs " + opfsState, tone: opfsState === "live" ? "" : "warn" },
      { label: "gpu " + gpuState, tone: gpuState === "ready" ? "" : (gpuState === "cold" ? "warn" : "warn") },
      { label: "biometric " + biometricState, tone: biometricState === "verified" ? "" : "warn" },
      { label: "locks " + locksState, tone: locksState === "available" ? "" : "warn" },
      { label: "crdt " + (Object.keys(crdtRegister.vectorClock).length > 1 ? "converged" : "local"), tone: Object.keys(crdtRegister.vectorClock).length > 1 ? "" : "warn" },
    ];

    runtimeCaps.innerHTML = caps
      .map((cap) => {
        const toneClass = cap.tone ? " " + cap.tone : "";
        return '<span class="fabric-pill' + toneClass + '">' + escapeHtml(cap.label) + "</span>";
      })
      .join("");
  }

  function syncChainStatus() {
    const height = Math.max(0, proofChain.length - 1);
    controls.btnChain.textContent = currentProofBlock ? "Verify anchored proof" : "Generate proof block";
    if (currentProofBlock) {
      swStatus.textContent =
        "height " +
        height +
        " / block #" +
        currentProofBlock.index +
        " / " +
        shortHash(currentProofBlock.hash, 18);
    } else {
      swStatus.textContent = "height " + height + " / ready to mine";
    }
    renderChainExplorer();
  }

  function renderChainExplorer() {
    const headBlock = proofChain[proofChain.length - 1] || null;
    const anchoredCount = Math.max(0, proofChain.length - 1);
    chainSummary.textContent = proofChain.length + " blocks / " + anchoredCount + " anchored attestations";
    chainHead.textContent = headBlock ? "head " + shortHash(headBlock.hash, 24) : "head pending";
    chainMode.textContent = location.hostname.includes("vercel.app")
      ? "scope browser-local even on Vercel"
      : "scope browser-local per visitor";

    if (!proofChain.length) {
      setLed(chainLed, "empty", "warn");
      chainExplorerList.innerHTML = '<div class="audit-empty">No local chain found.</div>';
      return;
    }

    setLed(chainLed, proofChain.length > 1 ? "anchored" : "genesis", proofChain.length > 1 ? "hot" : "cold");
    chainExplorerList.innerHTML = proofChain
      .slice()
      .reverse()
      .map((block) => {
        const payload = block.payload || {};
        const isCurrent = currentProofBlock && currentProofBlock.hash === block.hash;
        const typeLabel = payload.type === "attestation.anchor" ? "Anchor block #" + block.index : "Genesis block";
        const meta = [
          "miner " + (block.miner || "unknown"),
          "nonce " + block.nonce,
          "difficulty " + block.difficulty,
        ];
        if (payload.sealNumber) {
          meta.push("seal " + payload.sealNumber);
        }
        return (
          '<article class="audit-item">' +
          '<div class="audit-top"><span class="audit-type">' +
          escapeHtml(typeLabel) +
          '</span><span class="audit-hash mono">' +
          escapeHtml(shortHash(block.hash, 24)) +
          "</span></div>" +
          '<div class="fabric-meta">' +
          meta.map((item) => "<span>" + escapeHtml(item) + "</span>").join("") +
          (isCurrent ? '<span class="fabric-pill local">active seal</span>' : "") +
          "</div>" +
          '<div class="audit-body">' +
          escapeHtml(block.ts) +
          "<br>prev " +
          escapeHtml(shortHash(block.prevHash, 24)) +
          (payload.attestationDigest
            ? "<br>digest " + escapeHtml(shortHash(payload.attestationDigest, 28))
            : "<br>" + escapeHtml(payload.note || "genesis state")) +
          (payload.operatorAlias ? "<br>operator " + escapeHtml(payload.operatorAlias) : "") +
          "</div></article>"
        );
      })
      .join("");
  }

  function setLed(element, label, tone) {
    element.textContent = label;
    element.className = "status-led " + tone;
  }

  async function ensureProofChain() {
    let stored = null;
    try {
      stored = await metaGet(META_PROOF_CHAIN);
    } catch (error) {
      console.error(error);
    }

    if (!stored) {
      try {
        stored = JSON.parse(localStorage.getItem("drynessProofChain") || "null");
      } catch (error) {
        console.error(error);
      }
    }

    if (Array.isArray(stored) && stored.length) {
      proofChain = stored;
    } else {
      const genesis = createGenesisBlock();
      proofChain = [genesis];
      await persistProofChain();
    }

    syncChainStatus();
    renderRuntimeCaps();
    return proofChain;
  }

  async function persistProofChain() {
    try {
      await metaSet(META_PROOF_CHAIN, proofChain);
    } catch (error) {
      console.error(error);
    }
    try {
      localStorage.setItem("drynessProofChain", JSON.stringify(proofChain));
    } catch (storageError) {
      console.error(storageError);
    }
    syncChainStatus();
    renderRuntimeCaps();
  }

  function createGenesisBlock() {
    const genesis = {
      index: 0,
      ts: "2026-03-29T00:00:00.000Z",
      prevHash: "0".repeat(64),
      difficulty: 1,
      nonce: 0,
      miner: "genesis-node",
      payload: {
        type: "genesis",
        note: "Initial chain state",
      },
    };
    genesis.hash = computeToyBlockHash(genesis);
    return genesis;
  }

  function computeToyBlockHash(block) {
    return toyHash(
      canonicalize({
        index: block.index,
        ts: block.ts,
        prevHash: block.prevHash,
        difficulty: block.difficulty,
        nonce: block.nonce,
        miner: block.miner,
        payload: block.payload,
      })
    );
  }

  function toyHash(value) {
    let out = "";
    for (let seed = 0; seed < 8; seed += 1) {
      out += hash32(value + "|" + seed).toString(16).padStart(8, "0");
    }
    return out;
  }

  function hash32(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function findProofBlock(attestationDigest) {
    if (!attestationDigest) return null;
    return (
      proofChain.find((block) => {
        return block && block.payload && block.payload.attestationDigest === attestationDigest;
      }) || null
    );
  }

  function verifyProofChain() {
    if (!proofChain.length) {
      return { valid: false, reason: "empty chain" };
    }

    for (let index = 0; index < proofChain.length; index += 1) {
      const block = proofChain[index];
      const expected = computeToyBlockHash(block);
      if (block.hash !== expected) {
        return { valid: false, reason: "hash mismatch", block };
      }
      if (index === 0) continue;
      const previous = proofChain[index - 1];
      if (block.prevHash !== previous.hash) {
        return { valid: false, reason: "broken link", block };
      }
      if (!block.hash.startsWith("0".repeat(block.difficulty))) {
        return { valid: false, reason: "invalid work", block };
      }
    }

    return { valid: true, height: proofChain.length - 1 };
  }

  async function loadUnifiedAuditEvents() {
    const idbEvents = await loadAllEvents();
    const byHash = new Map();
    for (let i = 0; i < idbEvents.length; i += 1) {
      const e = idbEvents[i];
      if (e && e.hash) byHash.set(e.hash, e);
    }
    if (opfsState === "live" && opfsWorker) {
      try {
        const res = await runOpfsJob("read-all", null);
        const records = (res && res.records) || [];
        for (let j = 0; j < records.length; j += 1) {
          const row = records[j];
          if (row && row.hash && !byHash.has(row.hash)) {
            byHash.set(row.hash, row);
          }
        }
      } catch (err) {
        console.error("opfs read-all failed", err);
      }
    }
    return Array.from(byHash.values()).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  }

  async function exportAuditLedger() {
    const events = await loadUnifiedAuditEvents();
    if (!events.length) {
      showToast("Ledger is empty");
      return;
    }
    const blob = new Blob([JSON.stringify(events, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    downloadBlob(blob, "session-audit-ledger.json");
    await appendAuditEvent("ledger.exported", {
      eventCount: events.length,
      mergedOpfs: opfsState === "live",
    });
    showToast("Exported " + events.length + " events (IndexedDB + OPFS merged)");
  }

  async function replayAuditLedger() {
    const events = await loadUnifiedAuditEvents();
    if (!events.length) {
      showToast("Ledger is empty");
      return;
    }

    chainBackdrop.classList.remove("hidden");
    chainSpinner.classList.remove("hidden");
    chainStatus.textContent = "Replaying event log…";

    const replay = await runWorkerJob("replay", {
      events,
    });

    chainSpinner.classList.add("hidden");
    chainStatus.innerHTML =
      "Replay complete.<br><strong>" +
      escapeHtml(replay.verdict) +
      "</strong><br>Entropy " +
      escapeHtml(String(replay.entropy)) +
      "<br><code>" +
      escapeHtml(replay.digest) +
      "</code>";
    await appendAuditEvent("ledger.replayed", {
      eventCount: replay.count,
      entropy: replay.entropy,
      digest: replay.digest,
    });
  }

  async function showLedgerProof() {
    if (!activeAttestation) {
      showToast("No attestation available — complete a compliant session first");
      return;
    }

    await ensureProofChain();
    chainBackdrop.classList.remove("hidden");
    chainSpinner.classList.remove("hidden");
    chainStatus.textContent = "Searching local proof chain…";
    await sleep(300);

    const digest = activeAttestation.signing.attestationDigest;
    let block = findProofBlock(digest);

    if (!block) {
      chainStatus.textContent = "Generating proof block…";
      const prevBlock = proofChain[proofChain.length - 1];
      block = await runWorkerJob("mineBlock", {
        index: proofChain.length,
        prevHash: prevBlock.hash,
        difficulty: 4,
        miner: nodeLabel,
        payload: {
          type: "attestation.anchor",
          sealNumber: activeCertificate.sealNumber,
          operatorAlias: activeCertificate.operatorAlias,
          attestationDigest: digest,
          councilDigest: activeCertificate.councilDigest,
          ledgerHead: auditHead,
          modelScore: activeCertificate.modelScore,
          issuedAtIso: activeCertificate.issuedAtIso,
        },
      });
      proofChain.push(block);
      currentProofBlock = block;
      await persistProofChain();
      await appendAuditEvent("proof.block_mined", {
        blockIndex: block.index,
        hash: shortHash(block.hash, 20),
        nonce: block.nonce,
        difficulty: block.difficulty,
      });
    } else {
      currentProofBlock = block;
      syncChainStatus();
    }

    const verification = verifyProofChain();
    chainSpinner.classList.add("hidden");
    chainStatus.innerHTML =
      (verification.valid ? "Proof verified." : "Proof invalid.") +
      "<br><strong class=\"mono\">" +
      escapeHtml(block.hash) +
      "</strong><br>Block #" +
      escapeHtml(String(block.index)) +
      " nonce " +
      escapeHtml(String(block.nonce)) +
      " difficulty " +
      escapeHtml(String(block.difficulty)) +
      "<br>Attestation " +
      escapeHtml(shortHash(digest, 28)) +
      "<br>Chain height " +
      escapeHtml(String(Math.max(0, proofChain.length - 1)));
    await appendAuditEvent("proof.verified", {
      blockIndex: block.index,
      hash: shortHash(block.hash, 24),
      digest: shortHash(digest, 24),
      valid: verification.valid,
    });
  }

  async function exportProofChain() {
    await ensureProofChain();
    const payload = {
      scope: "browser-local",
      nodeId,
      nodeLabel,
      operatorAlias,
      exportedAtIso: new Date().toISOString(),
      chain: proofChain,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    downloadBlob(blob, "proof-chain.json");
    await appendAuditEvent("proof.chain_exported", {
      blockCount: proofChain.length,
      head: shortHash((proofChain[proofChain.length - 1] || {}).hash, 24),
    });
    showToast("Proof chain exported");
  }

  function exportVerdictCsv() {
    const row = [
      "verdict_iso8601",
      "verdict_enum",
      "operator_alias",
      "node_label",
      "quorum",
      "attestation_digest",
      "ledger_head",
      "worker_state",
    ];
    const line = [
      new Date().toISOString(),
      lastVerdict,
      operatorAlias,
      nodeLabel,
      activeCertificate ? activeCertificate.councilSummary : "n/a",
      activeAttestation ? activeAttestation.signing.attestationDigest : "n/a",
      auditHead,
      workerState,
    ];
    const csv =
      row.join(",") +
      "\n" +
      line.map((cell) => "\"" + String(cell).replace(/"/g, "\"\"") + "\"").join(",") +
      "\n";
    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8",
    });
    downloadBlob(blob, "shower_verdict.csv");
    showToast("CSV exported");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 3200);
  }

  function setQr(img, payload) {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    void renderQrImg(img, data, { width: 88, errorCorrectionLevel: "M" }).catch((err) => {
      console.warn("QR fallback", err);
      try {
        const safe = data.length > 1800 ? data.slice(0, 1800) : data;
        img.src =
          "https://api.qrserver.com/v1/create-qr-code/?size=88x88&data=" + encodeURIComponent(safe);
      } catch (_) {}
    });
  }

  function renderQrImg(img, dataString, options) {
    const opts = options || {};
    const width = opts.width != null ? opts.width : 220;
    const ec = opts.errorCorrectionLevel || "M";
    return new Promise((resolve, reject) => {
      if (window.QRCode && typeof window.QRCode.toDataURL === "function") {
        window.QRCode.toDataURL(
          dataString,
          {
            width: width,
            margin: opts.margin != null ? opts.margin : 2,
            errorCorrectionLevel: ec,
            color: { dark: "#0a4d68ff", light: "#ffffffff" },
          },
          (err, url) => {
            if (err) {
              reject(err);
              return;
            }
            img.src = url;
            resolve(url);
          }
        );
        return;
      }
      if (dataString.length > 1800) {
        reject(new Error("Payload too long for remote QR fallback"));
        return;
      }
      try {
        img.src =
          "https://api.qrserver.com/v1/create-qr-code/?size=" +
          width +
          "x" +
          width +
          "&data=" +
          encodeURIComponent(dataString);
        resolve(img.src);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function getDb() {
    if (!("indexedDB" in window)) {
      throw new Error("IndexedDB unavailable");
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        let eventsStore;
        if (!db.objectStoreNames.contains(EVENTS_STORE)) {
          eventsStore = db.createObjectStore(EVENTS_STORE, { keyPath: "id" });
        } else {
          eventsStore = request.transaction.objectStore(EVENTS_STORE);
        }
        if (!eventsStore.indexNames.contains("byTs")) {
          eventsStore.createIndex("byTs", "ts");
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error || new Error("IndexedDB open failed"));
      };
    });

    return dbPromise;
  }

  async function metaGet(key) {
    const db = await getDb();
    const tx = db.transaction(META_STORE, "readonly");
    const value = await requestToPromise(tx.objectStore(META_STORE).get(key));
    await txComplete(tx);
    return value ? value.value : undefined;
  }

  async function metaSet(key, value) {
    const db = await getDb();
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put({ key, value });
    await txComplete(tx);
  }

  async function loadRecentEvents(limit) {
    const db = await getDb();
    const tx = db.transaction(EVENTS_STORE, "readonly");
    const store = tx.objectStore(EVENTS_STORE).index("byTs");
    const items = [];
    await new Promise((resolve, reject) => {
      const request = store.openCursor(null, "prev");
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && items.length < limit) {
          items.push(cursor.value);
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => {
        reject(request.error || new Error("Cursor failed"));
      };
    });
    await txComplete(tx);
    return items;
  }

  async function loadAllEvents() {
    try {
      const db = await getDb();
      const tx = db.transaction(EVENTS_STORE, "readonly");
      const items = await requestToPromise(tx.objectStore(EVENTS_STORE).getAll());
      await txComplete(tx);
      return items.sort((a, b) => b.ts.localeCompare(a.ts));
    } catch (error) {
      console.error(error);
      return memoryLedger.slice();
    }
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  function txComplete(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    });
  }

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

  async function sha256Base64Url(input) {
    if (window.crypto && window.crypto.subtle) {
      const digest = await window.crypto.subtle.digest("SHA-256", encoder.encode(String(input)));
      return toBase64Url(digest);
    }
    return "soft-" + escapeHtml(String(input)).slice(0, 28);
  }

  function toBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function makeId(prefix) {
    if (window.crypto && window.crypto.getRandomValues) {
      const bytes = new Uint8Array(8);
      window.crypto.getRandomValues(bytes);
      return prefix + "-" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return prefix + "-" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function makeOperatorAlias(seed) {
    const adjectives = ["Admiral", "Captain", "Marshal", "Inspector", "Warden", "Sentinel", "Commodore", "Auditor"];
    const nouns = ["North", "Summit", "Harbor", "Ridge", "Cedar", "Atlas", "Vector", "Aurora"];
    const basis = String(seed || nodeId);
    const left = adjectives[hash32(basis + "|left") % adjectives.length];
    const right = nouns[hash32(basis + "|right") % nouns.length];
    const serial = 10 + (hash32(basis + "|serial") % 90);
    return left + " " + right + " " + serial;
  }

  function sanitizeAlias(value) {
    const cleaned = String(value || "")
      .replace(/[^a-zA-Z0-9 _-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 32);
    return cleaned || makeOperatorAlias(nodeId);
  }

  function formatNodeLabel(alias) {
    return alias + " / node-" + nodeId.slice(-6);
  }

  function previewData(data) {
    const text = JSON.stringify(data);
    if (!text) return "no payload";
    return text.length > 120 ? text.slice(0, 120) + "..." : text;
  }

  function shortHash(value, length) {
    if (!value) return "pending";
    return String(value).slice(0, length || 16);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  // ── ZK Commitment ──────────────────────────────────────────────────
  async function initZkWitness() {
    const bytes = new Uint8Array(32);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    zkNonce = bytes;
    setLed(zkLed, "witness ready", "hot");
    if (zkCommitmentDisplay) zkCommitmentDisplay.textContent = "nonce armed";
    renderRuntimeCaps();
  }

  async function buildZkCommitment(verdict, tsIso) {
    const nonceHex = Array.from(zkNonce, (b) => b.toString(16).padStart(2, "0")).join("");
    const witness = verdict + "|" + tsIso + "|" + nonceHex;
    const commitment = await sha256Base64Url(witness);
    zkCommitmentDigest = commitment;
    setLed(zkLed, "committed", "hot");
    if (zkCommitmentDisplay) zkCommitmentDisplay.textContent = shortHash(commitment, 24);
    if (certZk) certZk.textContent = shortHash(commitment, 20);
    return {
      commitment,
      nonce: nonceHex,
      committedAt: tsIso,
      schema: "commitment.v1",
    };
  }

  async function verifyCommitmentProof(zkProof) {
    if (!zkProof || !zkProof.commitment || !zkProof.nonce) return false;
    const witness = "dry|" + zkProof.committedAt + "|" + zkProof.nonce;
    const check = await sha256Base64Url(witness);
    return check === zkProof.commitment;
  }

  // ── WebAuthn ───────────────────────────────────────────────────────
  async function attemptWebAuthnAssertion(challengeDigest) {
    if (!window.PublicKeyCredential) {
      biometricState = "unsupported";
      setLed(biometricLed, "unsupported", "warn");
      if (biometricStatus) biometricStatus.textContent = "not available";
      return null;
    }
    biometricState = "prompting";
    setLed(biometricLed, "prompting", "cold");
    if (biometricStatus) biometricStatus.textContent = "waiting for authenticator…";
    try {
      const challenge = encoder.encode(challengeDigest.slice(0, 32).padEnd(32, "0"));
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 60000,
          userVerification: "preferred",
          rpId: location.hostname || "localhost",
          allowCredentials: [],
        },
      });
      biometricState = "verified";
      const attachment = credential.authenticatorAttachment || "platform";
      setLed(biometricLed, "verified", "hot");
      if (biometricStatus) biometricStatus.textContent = "authenticator: " + attachment;
      return {
        credentialId: toBase64Url(credential.rawId),
        authenticatorData: toBase64Url(credential.response.authenticatorData),
        clientDataJSON: toBase64Url(credential.response.clientDataJSON),
        signature: toBase64Url(credential.response.signature),
        authenticatorAttachment: attachment,
      };
    } catch (err) {
      biometricState = err.name === "NotAllowedError" ? "dismissed" : "failed";
      const tone = biometricState === "dismissed" ? "cold" : "warn";
      setLed(biometricLed, biometricState, tone);
      if (biometricStatus) biometricStatus.textContent = err.name || "error";
      return null;
    }
  }

  // ── WebGPU ─────────────────────────────────────────────────────────
  async function initGpu() {
    if (!navigator.gpu) {
      gpuState = "unsupported";
      setLed(gpuLed, "unsupported", "warn");
      if (gpuStatus) gpuStatus.textContent = "WebGPU not available";
      renderRuntimeCaps();
      return;
    }
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("no adapter");
      gpuDevice = await adapter.requestDevice();
      gpuState = "ready";
      const info = adapter.info || {};
      setLed(gpuLed, "gpu ready", "hot");
      if (gpuStatus) gpuStatus.textContent = info.device || info.description || "adapter ready";
      gpuDevice.addEventListener("uncapturederror", () => {
        gpuState = "error";
        setLed(gpuLed, "gpu error", "warn");
      });
    } catch (err) {
      gpuState = "failed";
      setLed(gpuLed, "failed", "warn");
      if (gpuStatus) gpuStatus.textContent = err.message || "init error";
    }
    renderRuntimeCaps();
  }

  async function gpuHashPayload(payloadStr) {
    if (!gpuDevice) return null;
    try {
      const inputBytes = encoder.encode(payloadStr);
      const padded = Math.max(4, Math.ceil(inputBytes.length / 4) * 4);
      const inputData = new Uint32Array(padded / 4);
      new Uint8Array(inputData.buffer).set(inputBytes);

      const inputBuffer = gpuDevice.createBuffer({
        size: inputData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const outputBuffer = gpuDevice.createBuffer({
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const readBuffer = gpuDevice.createBuffer({
        size: 16,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });

      gpuDevice.queue.writeBuffer(inputBuffer, 0, inputData);

      const shaderModule = gpuDevice.createShaderModule({
        code: `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;

@compute @workgroup_size(1)
fn main() {
  var h0: u32 = 0x6a09e667u;
  var h1: u32 = 0xbb67ae85u;
  var h2: u32 = 0x3c6ef372u;
  var h3: u32 = 0xa54ff53au;
  let n: u32 = arrayLength(&input);
  for (var i: u32 = 0u; i < n; i = i + 1u) {
    let w = input[i];
    h0 = h0 ^ (w * 0x9e3779b9u);
    h0 = (h0 << 13u) | (h0 >> 19u);
    h1 = h1 ^ (h0 + w);
    h1 = (h1 << 7u) | (h1 >> 25u);
    h2 = h2 ^ (h1 * 0x6c62272eu);
    h2 = (h2 << 17u) | (h2 >> 15u);
    h3 = h3 ^ (h2 + h0);
    h3 = (h3 << 11u) | (h3 >> 21u);
    h0 = h0 + h3;
  }
  output[0] = h0;
  output[1] = h1;
  output[2] = h2;
  output[3] = h3;
}
        `,
      });

      const bindGroupLayout = gpuDevice.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        ],
      });
      const pipeline = gpuDevice.createComputePipeline({
        layout: gpuDevice.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        compute: { module: shaderModule, entryPoint: "main" },
      });
      const bindGroup = gpuDevice.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: inputBuffer } },
          { binding: 1, resource: { buffer: outputBuffer } },
        ],
      });

      const commandEncoder = gpuDevice.createCommandEncoder();
      const pass = commandEncoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
      commandEncoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, 16);
      gpuDevice.queue.submit([commandEncoder.finish()]);

      await readBuffer.mapAsync(GPUMapMode.READ);
      const result = new Uint32Array(readBuffer.getMappedRange().slice(0));
      readBuffer.unmap();

      inputBuffer.destroy();
      outputBuffer.destroy();
      readBuffer.destroy();

      const hashHex = Array.from(result, (v) => v.toString(16).padStart(8, "0")).join("");
      setLed(gpuLed, "hash computed", "hot");
      if (gpuStatus) gpuStatus.textContent = "gpu: " + hashHex.slice(0, 16) + "…";
      return { hash: hashHex, wordCount: inputData.length, algorithm: "wgsl-scatter-v1" };
    } catch (err) {
      gpuState = "compute-failed";
      setLed(gpuLed, "compute failed", "warn");
      if (gpuStatus) gpuStatus.textContent = err.message || "dispatch error";
      return null;
    }
  }

  // ── OPFS Worker ────────────────────────────────────────────────────
  function setupOpfsWorker() {
    if (!("storage" in navigator && "getDirectory" in navigator.storage)) {
      opfsState = "unsupported";
      setLed(opfsLed, "unsupported", "warn");
      if (opfsStatus) opfsStatus.textContent = "OPFS not available";
      renderRuntimeCaps();
      return;
    }
    if (location.protocol === "file:") {
      opfsState = "blocked";
      setLed(opfsLed, "blocked on file://", "warn");
      if (opfsStatus) opfsStatus.textContent = "file:// blocked";
      renderRuntimeCaps();
      return;
    }
    try {
      opfsWorker = new Worker(new URL("./opfs-worker.js", window.location.href));
      opfsWorker.addEventListener("message", (event) => {
        const { id, result, error } = event.data || {};
        const pending = opfsPending.get(id);
        if (!pending) return;
        opfsPending.delete(id);
        if (error) { pending.reject(new Error(error)); return; }
        pending.resolve(result);
      });
      opfsWorker.addEventListener("error", () => {
        opfsState = "worker-faulted";
        setLed(opfsLed, "worker faulted", "warn");
        renderRuntimeCaps();
      });
      void runOpfsJob("open", null).then((res) => {
        opfsState = "live";
        setLed(opfsLed, "opfs live", "hot");
        if (opfsStatus) opfsStatus.textContent = "opfs " + (res.existingBytes || 0) + "B";
        renderRuntimeCaps();
      }).catch((err) => {
        opfsState = "open-failed";
        setLed(opfsLed, "open failed", "warn");
        if (opfsStatus) opfsStatus.textContent = err.message || "open error";
        renderRuntimeCaps();
      });
    } catch (err) {
      opfsState = "init-failed";
      setLed(opfsLed, "init failed", "warn");
      if (opfsStatus) opfsStatus.textContent = err.message || "init error";
    }
    renderRuntimeCaps();
  }

  function runOpfsJob(type, payload) {
    if (!opfsWorker) return Promise.reject(new Error("opfs worker not running"));
    opfsSeq += 1;
    const id = "opfs-" + opfsSeq;
    return new Promise((resolve, reject) => {
      opfsPending.set(id, { resolve, reject });
      opfsWorker.postMessage({ id, type, payload });
    });
  }

  async function opfsAppend(event) {
    if (opfsState !== "live") return;
    try {
      const res = await runOpfsJob("append", event);
      lastOpfsAppendTotal = res && res.total != null ? res.total : lastOpfsAppendTotal;
      if (opfsStatus) opfsStatus.textContent = "opfs " + (res.total || 0) + "B";
    } catch (err) {
      console.error("opfs append failed", err);
    }
  }

  // ── Web Locks ──────────────────────────────────────────────────────
  function initWebLocks() {
    if (!("locks" in navigator)) {
      locksState = "unsupported";
      setLed(locksLed, "unsupported", "warn");
      renderRuntimeCaps();
      return;
    }
    locksState = "available";
    setLed(locksLed, "locks available", "hot");
    renderRuntimeCaps();
  }

  // ── CRDT (LWW-Register with vector clock) ─────────────────────────
  function crdtWrite(value) {
    const ts = Date.now();
    crdtRegister.value = value;
    crdtRegister.timestamp = ts;
    crdtRegister.vectorClock[nodeId] = (crdtRegister.vectorClock[nodeId] || 0) + 1;
    renderCrdtStatus();
    if (councilChannel) {
      councilChannel.postMessage({
        type: "crdt.sync",
        nodeId,
        label: nodeLabel,
        crdt: {
          value,
          timestamp: ts,
          vectorClock: { ...crdtRegister.vectorClock },
        },
      });
    }
  }

  function crdtMerge(message) {
    const remote = message && message.crdt;
    if (!remote) return;
    const prevTs = crdtRegister.timestamp;
    const prevVal = crdtRegister.value;
    const fromPeer = message.nodeId && message.nodeId !== nodeId;
    if (remote.timestamp > crdtRegister.timestamp) {
      crdtRegister.value = remote.value;
      crdtRegister.timestamp = remote.timestamp;
    }
    if (remote.vectorClock) {
      Object.keys(remote.vectorClock).forEach((key) => {
        crdtRegister.vectorClock[key] = Math.max(
          crdtRegister.vectorClock[key] || 0,
          remote.vectorClock[key] || 0
        );
      });
    }
    renderCrdtStatus();
    if (
      fromPeer &&
      remote.timestamp > prevTs &&
      crdtRegister.value !== prevVal &&
      crdtRegister.value
    ) {
      lastVerdict = crdtRegister.value;
      consensusSummary.textContent = "Synced from another tab: " + String(crdtRegister.value);
      showToast("Another window recorded: " + String(crdtRegister.value));
    }
  }

  function renderCrdtStatus() {
    const nodes = Object.keys(crdtRegister.vectorClock).length;
    const clockStr = Object.entries(crdtRegister.vectorClock)
      .map(([k, v]) => k.slice(-4) + ":" + v)
      .join(", ");
    setLed(crdtLed, nodes > 1 ? "converged" : "local state", nodes > 1 ? "hot" : "cold");
    if (crdtVectorDisplay) crdtVectorDisplay.textContent = clockStr || "empty";
    const crdtValueEl = document.getElementById("crdtValue");
    if (crdtValueEl) crdtValueEl.textContent = crdtRegister.value || "null";
  }
})();
