// ----------------------
// DOM ELEMENTS
// ----------------------
const itemNameInput = document.getElementById("itemName");
const barcodeInput = document.getElementById("barcode");
const storePriceInput = document.getElementById("storePrice");

const startScannerBtn = document.getElementById("startScannerBtn");
const stopScannerBtn = document.getElementById("stopScannerBtn");
const scannerContainer = document.getElementById("scanner-container");
const scannerStatus = document.getElementById("scannerStatus");

const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");

let scannerRunning = false;

// ----------------------
// BARCODE SCANNING
// ----------------------
function startScanner() {
  if (scannerRunning) return;

  scannerContainer.style.display = "block";
  scannerStatus.textContent = "Starting camera…";

  Quagga.init(
    {
      inputStream: {
        type: "LiveStream",
        target: document.querySelector("#scanner"),
        constraints: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      },
      locator: {
        patchSize: "medium",
        halfSample: true
      },
      numOfWorkers: 2,
      frequency: 10,
      decoder: {
        readers: ["ean_13_reader", "upc_reader"]
      },
      locate: true
    },
    err => {
      if (err) {
        scannerStatus.textContent = "Error: " + err.message;
        return;
      }
      Quagga.start();
      scannerRunning = true;
      scannerStatus.textContent = "Point at a barcode…";
      startScannerBtn.style.display = "none";
      stopScannerBtn.style.display = "inline-block";
    }
  );

  Quagga.onDetected(onBarcodeDetected);
}

function stopScanner() {
  if (!scannerRunning) return;
  Quagga.stop();
  Quagga.offDetected(onBarcodeDetected);
  scannerRunning = false;
  scannerContainer.style.display = "none";
  startScannerBtn.style.display = "inline-block";
  stopScannerBtn.style.display = "none";
}

function onBarcodeDetected(data) {
  const code = data.codeResult.code;
  barcodeInput.value = code;
  scannerStatus.textContent = "Detected: " + code;
  stopScanner();
}

startScannerBtn.addEventListener("click", startScanner);
stopScannerBtn.addEventListener("click", stopScanner);

// ----------------------
// TARGET API LOOKUP
// ----------------------
async function lookupTCIN(upc) {
  const url = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v1?key=ff457966e64d1e877fdbad070f276d8e&keyword=${upc}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  const items = data?.data?.search?.products;
  if (!items || items.length === 0) return null;

  return items[0].tcin;
}

async function searchTargetByName(name) {
  const url = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v1?key=ff457966e64d1e877fdbad070f276d8e&keyword=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  const items = data?.data?.search?.products;
  if (!items || items.length === 0) return null;

  return items[0].tcin;
}

async function getTargetPrice(tcin) {
  const url = `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?key=ff457966e64d1e877fdbad070f276d8e&tcin=${tcin}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  const item = data?.data?.product?.item;
  if (!item) return null;

  return {
    title: item.product_description?.title,
    price: item.price?.current_retail
  };
}

// ----------------------
// UPCitemDB FALLBACK
// ----------------------
async function lookupUPCitemDB(upc) {
  const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (!data.items || data.items.length === 0) return null;

  const item = data.items[0];
  return {
    title: item.title,
    price: item.lowest_recorded_price || item.highest_recorded_price || null
  };
}

async function searchUPCitemDBByName(name) {
  const url = `https://api.upcitemdb.com/prod/trial/search?s=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (!data.items || data.items.length === 0) return null;

  const item = data.items[0];
  return {
    title: item.title,
    price: item.lowest_recorded_price || item.highest_recorded_price || null
  };
}

// ----------------------
// MAIN CHECK FUNCTION
// ----------------------
async function checkDeal() {
  const upc = barcodeInput.value.trim();
  const name = itemNameInput.value.trim();
  const storePrice = parseFloat(storePriceInput.value.trim());

  resultEl.textContent = "";
  statusEl.textContent = "";

  if (!upc && !name) {
    statusEl.textContent = "Enter a barcode OR an item name.";
    return;
  }
  if (!storePrice) {
    statusEl.textContent = "Enter the store price.";
    return;
  }

  let info = null;
  let source = "";

  // UPC SEARCH
  if (upc) {
    statusEl.textContent = "Checking Target…";

    const tcin = await lookupTCIN(upc);
    if (tcin) {
      info = await getTargetPrice(tcin);
      if (info && info.price) source = "Target";
    }

    if (!info || !info.price) {
      statusEl.textContent = "Checking UPCitemDB…";
      info = await lookupUPCitemDB(upc);
      if (info && info.price) source = "UPCitemDB";
    }
  }

  // NAME SEARCH
  if (!upc && name) {
    statusEl.textContent = "Searching Target by name…";

    const tcin = await searchTargetByName(name);
    if (tcin) {
      info = await getTargetPrice(tcin);
      if (info && info.price) source = "Target";
    }

    if (!info || !info.price) {
      statusEl.textContent = "Searching UPCitemDB…";
      info = await searchUPCitemDBByName(name);
      if (info && info.price) source = "UPCitemDB";
    }
  }

  if (!info || !info.price) {
    statusEl.textContent = "";
    resultEl.textContent = "No online price found.";
    return;
  }

  const onlinePrice = info.price;
  let verdict = "";

  if (storePrice < onlinePrice) verdict = "GOOD DEAL 👍";
  else if (storePrice === onlinePrice) verdict = "AVERAGE DEAL 😐";
  else verdict = "OVERPRICED 👎";

  resultEl.textContent =
    `Source: ${source}\n` +
    `Item: ${info.title}\n` +
    `Online Price: $${onlinePrice.toFixed(2)}\n` +
    `Store Price: $${storePrice.toFixed(2)}\n\n` +
    `Verdict: ${verdict}`;

  statusEl.textContent = "";
}

document.getElementById("checkBtn").addEventListener("click", checkDeal);
