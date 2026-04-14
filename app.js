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
function fetchWithTimeout(url, ms = 4000) {
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
        res.text().then(text => {
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve(text);
          }
        });
      })
      .catch(() => resolve(null));
  });
}

// ----------------------
// TARGET API LOOKUP
// ----------------------
async function lookupTCIN(upc) {
  const url = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v1?key=ff457966e64d1e877fdbad070f276d8e&keyword=${upc}`;
  const data = await fetchWithTimeout(url);
  const items = data?.data?.search?.products;
  return items?.length ? items[0].tcin : null;
}

async function searchTargetByName(name) {
  const url = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v1?key=ff457966e64d1e877fdbad070f276d8e&keyword=${encodeURIComponent(name)}`;
  const data = await fetchWithTimeout(url);
  const items = data?.data?.search?.products;
  return items?.length ? items[0].tcin : null;
}

async function getTargetPrice(tcin) {
  const url = `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?key=ff457966e64d1e877fdbad070f276d8e&tcin=${tcin}`;
  const data = await fetchWithTimeout(url);
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
  const data = await fetchWithTimeout(url);
  if (!data?.items?.length) return null;

  const item = data.items[0];
  return {
    title: item.title,
    price: item.lowest_recorded_price || item.highest_recorded_price || null
  };
}

async function searchUPCitemDBByName(name) {
  const url = `https://api.upcitemdb.com/prod/trial/search?s=${encodeURIComponent(name)}`;
  const data = await fetchWithTimeout(url);
  if (!data?.items?.length) return null;

  const item = data.items[0];
  return {
    title: item.title,
    price: item.lowest_recorded_price || item.highest_recorded_price || null
  };
}

// ----------------------
// GOOGLE SHOPPING SCRAPER
// ----------------------
async function googleShoppingSearch(query) {
  const url = `https://corsproxy.io/?https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`;
  const html = await fetchWithTimeout(url, 5000);
  if (!html) return null;

  const text = typeof html === "string" ? html : JSON.stringify(html);
  const priceMatch = text.match(/\$\d+\.\d{2}/);

  if (!priceMatch) return null;

  return {
    title: query,
    price: parseFloat(priceMatch[0].replace("$", ""))
  };
}

// ----------------------
// GEMINI UPC → NAME
// ----------------------
async function guessNameFromUPC(upc) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=AIzaSyAlus5j7IGwc0LWn3nU6VajSU3Uk4Pl7rM`;

  const body = {
    contents: [{
      parts: [{
        text: `What product is this UPC for? Return ONLY the product name: ${upc}`
      }]
    }]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => null);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  return text?.trim() || null;
}

// ----------------------
// UNIFIED PRICE LOOKUP
// ----------------------
async function getBestOnlinePrice(upc, name) {
  let info = null;

  // 1. Target by UPC
  if (upc) {
    const tcin = await lookupTCIN(upc);
    if (tcin) {
      info = await getTargetPrice(tcin);
      if (info?.price) return { ...info, source: "Target" };
    }
  }

  // 2. UPCitemDB by UPC
  if (upc) {
    info = await lookupUPCitemDB(upc);
    if (info?.price) return { ...info, source: "UPCitemDB" };
  }

  // 3. Target by name
  if (name) {
    const tcin = await searchTargetByName(name);
    if (tcin) {
      info = await getTargetPrice(tcin);
      if (info?.price) return { ...info, source: "Target" };
    }
  }

  // 4. UPCitemDB by name
  if (name) {
    info = await searchUPCitemDBByName(name);
    if (info?.price) return { ...info, source: "UPCitemDB" };
  }

  // 5. Gemini guess → Google Shopping
  if (upc && !name) {
    const guessed = await guessNameFromUPC(upc);
    if (guessed) {
      info = await googleShoppingSearch(guessed);
      if (info?.price) return { ...info, source: "Google Shopping (AI guessed)" };
    }
  }

  // 6. Google Shopping by name
  if (name) {
    info = await googleShoppingSearch(name);
    if (info?.price) return { ...info, source: "Google Shopping" };
  }

  return null;
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

  statusEl.textContent = "Searching online…";

  const info = await getBestOnlinePrice(upc, name);

  if (!info) {
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
    `Source: ${info.source}\n` +
    `Item: ${info.title}\n` +
    `Online Price: $${onlinePrice.toFixed(2)}\n` +
    `Store Price: $${storePrice.toFixed(2)}\n\n` +
    `Verdict: ${verdict}`;

  statusEl.textContent = "";
}

document.getElementById("checkBtn").addEventListener("click", checkDeal);
