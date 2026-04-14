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
// TIMEOUT HELPER
// ----------------------
function fetchWithTimeout(url, ms = 5000) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, ms);

    fetch(url, { signal: controller.signal })
      .then(res => {
        clearTimeout(timer);
        if (!res.ok) return resolve(null);
        res.json().then(resolve).catch(() => resolve(null));
      })
      .catch(() => resolve(null));
  });
}

// ----------------------
// OPENFOODFACTS UPC LOOKUP
// ----------------------
async function lookupOpenFoodFacts(upc) {
  const url = `https://world.openfoodfacts.org/api/v0/product/${upc}.json`;
  const data = await fetchWithTimeout(url);

  if (!data || data.status !== 1) return null;

  const product = data.product;

  return {
    title: product.product_name || product.generic_name || "Unknown product",
    brand: product.brands || "Unknown brand"
  };
}

// ----------------------
// MAIN CHECK FUNCTION (NO PRICE LOGIC)
// ----------------------
async function checkDeal() {
  const upc = barcodeInput.value.trim();
  const name = itemNameInput.value.trim();

  resultEl.textContent = "";
  statusEl.textContent = "";

  if (!upc && !name) {
    statusEl.textContent = "Enter a barcode OR an item name.";
    return;
  }

  statusEl.textContent = "Looking up product…";

  let info = null;

  // Only UPC lookup now
  if (upc) {
    info = await lookupOpenFoodFacts(upc);
  }

  if (!info) {
    statusEl.textContent = "";
    resultEl.textContent = "Product not found in OpenFoodFacts.";
    return;
  }

  // Display product info only
  resultEl.textContent =
    `Product: ${info.title}\n` +
    `Brand: ${info.brand}\n` +
    `UPC: ${upc}`;

  statusEl.textContent = "";
}

document.getElementById("checkBtn").addEventListener("click", checkDeal);
