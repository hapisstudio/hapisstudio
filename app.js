const DEFAULT_CONFIG = {
  gasUrl: 'https://script.google.com/macros/s/AKfycbzY3xtviFis2qsTvAVYhlp7h3r_PrCsNGWDxB_CbRJk8AM9iSplhxJRKiXlaYORHcK0/exec',
  apiToken: 'GudangSecretToken_2026_SecureKey'
};

const IDB_CONFIG = { 
  dbName: 'WarehouseControlDB_v3', 
  dbVersion: 1, 
  storeName: 'keyval' 
};

const AppState = {
  config: safeStorageGet('appHybridConfig_v3', DEFAULT_CONFIG),
  currentUser: safeStorageGet('warehouse_user', null),
  thermalPrinterName: safeStorageGet('warehouse_printer_name', 'MINIPOS'),
  thermalMode: safeStorageGet('warehouse_thermal_mode', 'bluetooth'),
  thermalPaperWidth: safeStorageGet('warehouse_thermal_width', '80mm'),
  autoPrintBluetooth: safeStorageGet('warehouse_autoprint_bt', true),
  printedOrderIds: new Set(safeStorageGet('warehouse_printed_orders', [])),
  inFlightPrintIds: new Set(),
  
  // Persistent Web Bluetooth Session State
  btDevice: null,
  btServer: null,
  btCharacteristic: null,
  isBtConnecting: false,

  activeThermalOrderId: null,
  isBatchThermal: false,
  globalOrders: [],
  globalStok: [],
  currentOrderFilter: 'Pending',
  activePickingOrder: null,
  selectedOrderIds: new Set(),
  currentScanTarget: 'order',
  html5QrcodeScanner: null,
  isFlashOn: false,
  currentPrintOrderId: null,
  currentStatusOrderId: null,
  currentStatusSheet: '',
  pendingAmbilAlihOrderId: null,
  pendingBatalOrderId: null,
  pendingBatchPages: [],
  offlineActionQueue: safeStorageGet('offline_action_queue', []),
  currentStokStatusFilter: 'all',
  lastSeenOrderIds: new Set(),
  lastSeenLowStock: new Set(),
  notifMuted: safeStorageGet('warehouse_notif_muted', false),

  get namaPicker() {
    return this.currentUser ? (this.currentUser.name || this.currentUser.username) : '';
  }
};

const Motion = {
  counter(elId, targetVal, isCurrency = false, suffix = '') {
    const el = document.getElementById(elId);
    if (!el) return;
    if (typeof gsap === 'undefined') {
      el.innerText = isCurrency ? formatRupiah(targetVal) : `${targetVal}${suffix}`;
      return;
    }
    const startVal = parseFloat(el.getAttribute('data-val') || 0);
    el.setAttribute('data-val', targetVal);
    const obj = { val: startVal };
    gsap.to(obj, {
      val: targetVal,
      duration: 0.65,
      ease: 'power2.out',
      onUpdate: () => {
        el.innerText = isCurrency ? formatRupiah(Math.round(obj.val)) : `${Math.round(obj.val)}${suffix}`;
      }
    });
  },
  staggerCards(selector) {
    if (typeof gsap === 'undefined') return;
    gsap.fromTo(selector, 
      { opacity: 0, y: 12, scale: 0.985 },
      { opacity: 1, y: 0, scale: 1, duration: 0.32, stagger: 0.035, ease: 'power2.out' }
    );
  },
  viewEnter(el) {
    if (!el || typeof gsap === 'undefined') return;
    gsap.fromTo(el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out' });
  }
};

function initTheme() {
  const savedTheme = safeStorageGet('warehouse_theme', 'dark');
  const isDark = savedTheme !== 'light';
  document.documentElement.classList.toggle('dark', isDark);
  updateThemeUI(isDark);
}

function updateThemeUI(isDark) {
  const icon = document.getElementById('themeToggleIcon');
  if (icon) icon.innerText = isDark ? 'light_mode' : 'dark_mode';
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  safeStorageSet('warehouse_theme', isDark ? 'dark' : 'light');
  updateThemeUI(isDark);
  showToast(isDark ? "Mode Gelap" : "Mode Terang", "Preferensi tema telah disimpan.");
}

function safeStorageGet(key, fallback = null) {
  try {
    const item = localStorage.getItem(key);
    return item !== null ? JSON.parse(item) : fallback;
  } catch (e) {
    return fallback;
  }
}

function safeStorageSet(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {}
}

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB tidak tersedia"));
    const req = indexedDB.open(IDB_CONFIG.dbName, IDB_CONFIG.dbVersion);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_CONFIG.storeName)) {
        db.createObjectStore(IDB_CONFIG.storeName);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key, fallback = null) {
  try {
    const db = await openIndexedDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_CONFIG.storeName, 'readonly');
      const req = tx.objectStore(IDB_CONFIG.storeName).get(key);
      req.onsuccess = () => resolve(req.result !== undefined ? req.result : fallback);
      req.onerror = () => resolve(fallback);
    });
  } catch (e) {
    return safeStorageGet(key, fallback);
  }
}

async function idbSet(key, val) {
  try {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.storeName, 'readwrite');
      const req = tx.objectStore(IDB_CONFIG.storeName).put(val, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    safeStorageSet(key, val);
    return false;
  }
}

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatRupiah(angka) {
  if (angka === null || angka === undefined || isNaN(angka)) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);
}

function formatPersen(val) {
  if (val === null || val === undefined || val === '') return '0%';
  let num = parseFloat(String(val).replace('%', '').trim());
  if (isNaN(num)) return '0%';
  return `${num % 1 === 0 ? num : num.toFixed(1)}%`;
}

function getUserRole() {
  return AppState.currentUser ? String(AppState.currentUser.role || 'picker').toLowerCase().trim() : '';
}

function isPicker() {
  const r = getUserRole();
  return r === 'picker' || r === 'karyawan';
}

function isAdmin() {
  const r = getUserRole();
  return r === 'admin' || r === 'superadmin' || r === 'super admin';
}

function isSuperAdmin() {
  const r = getUserRole();
  return r === 'superadmin' || r === 'super admin';
}

function updateSessionUI() {
  const uNameEl = document.getElementById('headerUserName');
  const uRoleEl = document.getElementById('headerUserRole');

  if (AppState.currentUser) {
    if (uNameEl) uNameEl.innerText = AppState.currentUser.name || AppState.currentUser.username;
    if (uRoleEl) uRoleEl.innerText = (AppState.currentUser.role || 'PICKER').toUpperCase();
  } else {
    if (uNameEl) uNameEl.innerText = 'Belum Masuk';
    if (uRoleEl) uRoleEl.innerText = 'LOCKED';
  }

  applyUserRoleAccess();
}

function applyUserRoleAccess() {
  const pickerMode = isPicker();
  const metricsBox = document.getElementById('stockMetricsContainer');
  const btnCsv = document.getElementById('btnDownloadCsv');
  const tabSetting = document.getElementById('tabNavSetting');

  if (metricsBox) metricsBox.style.display = pickerMode ? 'none' : 'grid';
  if (btnCsv) btnCsv.style.display = pickerMode ? 'none' : 'inline-flex';
  if (tabSetting) tabSetting.style.display = pickerMode ? 'none' : 'flex';
}

async function handleInitialLogin(event) {
  if (event) event.preventDefault();
  const uInp = document.getElementById('loginUsername');
  const pInp = document.getElementById('loginPassword');
  const errEl = document.getElementById('loginErrorMsg');
  const btn = document.getElementById('btnLoginSubmit');

  const user = (uInp?.value || '').trim();
  const pass = (pInp?.value || '').trim();

  if (!user || !pass) {
    if (errEl) { errEl.innerText = "Masukkan username dan password!"; errEl.classList.remove('hidden'); }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Memverifikasi...';
  }

  try {
    const res = await fetchAPI('loginUser', { username: user, password: pass });
    if (res && res.success && res.user) {
      AppState.currentUser = res.user;
      AppState.currentUser._sessionPass = pass;
      
      safeStorageSet('warehouse_user', { 
        username: AppState.currentUser.username, 
        name: AppState.currentUser.name, 
        role: AppState.currentUser.role 
      });
      updateSessionUI();
      closeModal('modalLoginAwal');
      showToast("Login Berhasil", `Selamat bertugas, ${AppState.namaPicker}`);
      loadAdminData(true);
    } else {
      if (errEl) {
        errEl.innerText = (res && res.message) || "Kredensial salah atau tidak terdaftar.";
        errEl.classList.remove('hidden');
      }
    }
  } catch (e) {
    if (errEl) {
      errEl.innerText = "Gagal memproses login: " + e.message;
      errEl.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Masuk';
    }
  }
}

function logoutPengguna() {
  openModal('modalKonfirmasiLogout');
}

function eksekusiLogout() {
  closeModal('modalKonfirmasiLogout');
  AppState.currentUser = null;
  localStorage.removeItem('warehouse_user');
  sessionStorage.clear();
  updateSessionUI();
  switchMainTab('order');
  openModal('modalLoginAwal');
  showToast("Sesi Berakhir", "Anda telah keluar.");
}

async function fetchAPI(action, params = {}) {
  const formData = new URLSearchParams();
  formData.append('action', action);
  formData.append('token', AppState.config.apiToken || DEFAULT_CONFIG.apiToken);
  for (const k in params) {
    formData.append(k, params[k]);
  }
  const url = AppState.config.gasUrl || DEFAULT_CONFIG.gasUrl;
  const res = await fetch(url, { method: 'POST', body: formData });
  return await res.json();
}

function setSyncIndicator(active) {
  const bar = document.getElementById('silentSyncBar');
  const icon = document.getElementById('refreshIcon');
  if (bar) bar.style.width = active ? '100%' : '0%';
  if (icon) {
    if (active) icon.classList.add('animate-spin');
    else icon.classList.remove('animate-spin');
  }
}

function enqueueOfflineAction(payload, action = 'updateStatusPesanan') {
  AppState.offlineActionQueue.push({ id: Date.now(), action, payload });
  safeStorageSet('offline_action_queue', AppState.offlineActionQueue);
  updateOutboxUI();
}

function updateOutboxUI() {
  const banner = document.getElementById('outboxBanner');
  const text = document.getElementById('outboxBannerText');
  if (banner && text) {
    if (AppState.offlineActionQueue.length > 0) {
      banner.classList.remove('hidden');
      banner.classList.add('flex');
      text.innerText = `${AppState.offlineActionQueue.length} aksi menunggu sinyal pulih...`;
    } else {
      banner.classList.add('hidden');
      banner.classList.remove('flex');
    }
  }
}

async function processOfflineQueue(manual = false) {
  if (!navigator.onLine || AppState.offlineActionQueue.length === 0) {
    if (manual) showToast("Antrean Kosong", "Semua data telah tersinkron.");
    return;
  }

  const queueCopy = [...AppState.offlineActionQueue];
  let sentCount = 0;

  for (const item of queueCopy) {
    try {
      const res = await fetchAPI(item.action || 'updateStatusPesanan', item.payload);
      if (res && res.success) {
        AppState.offlineActionQueue = AppState.offlineActionQueue.filter(q => q.id !== item.id);
        safeStorageSet('offline_action_queue', AppState.offlineActionQueue);
        sentCount++;
      }
    } catch (e) {
      break;
    }
  }

  updateOutboxUI();
  if (sentCount > 0) {
    showToast("Sinkronisasi Selesai", `${sentCount} aksi offline terkirim.`);
    loadAdminData(false);
  }
}

window.addEventListener('online', () => {
  const dot = document.getElementById('liveStatusDot');
  const txt = document.getElementById('liveStatusText');
  if (dot) dot.className = 'w-1.5 h-1.5 rounded-full bg-ios-green animate-pulse';
  if (txt) { txt.innerText = 'Online'; txt.className = 'text-ios-green font-bold uppercase'; }
  processOfflineQueue();
});

window.addEventListener('offline', () => {
  const dot = document.getElementById('liveStatusDot');
  const txt = document.getElementById('liveStatusText');
  if (dot) dot.className = 'w-1.5 h-1.5 rounded-full bg-ios-red';
  if (txt) { txt.innerText = 'Offline'; txt.className = 'text-ios-red font-bold uppercase'; }
  showToast("Offline", "Koneksi terputus. Data disimpan di lokal.");
});

function switchMainTab(tabName) {
  if (tabName === 'setting' && isPicker()) {
    showToast("Akses Terbatas", "Role Picker tidak memiliki izin ke Pengaturan.", true);
    return;
  }

  document.querySelectorAll('.view-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-dock-btn').forEach(btn => {
    btn.className = 'nav-dock-btn flex flex-col items-center justify-center gap-0.5 text-ios-text-ter hover:text-ios-text ios-press';
  });

  const targetView = document.getElementById(`view-${tabName}`);
  const targetBtn = document.getElementById(`tabNav${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
  const bottomNav = document.getElementById('bottomTabBar');

  if (bottomNav) {
    bottomNav.style.display = tabName === 'picking' ? 'none' : 'block';
  }

  if (targetView) {
    targetView.classList.remove('hidden');
    if (tabName === 'picking') targetView.classList.add('flex');
    Motion.viewEnter(targetView);
  }

  if (targetBtn) {
    targetBtn.className = 'nav-dock-btn flex flex-col items-center justify-center gap-0.5 text-ios-blue ios-press';
  }

  if (tabName === 'setting') loadSetupConfig();
  if (tabName === 'stok') filterStok(true);
  window.scrollTo(0, 0);
}

async function loadAdminData(showSpinner = false, announce = false) {
  setSyncIndicator(true);
  try {
    const res = await fetchAPI('getAdminData');
    setSyncIndicator(false);
    if (res && res.success) {
      AppState.globalStok = res.stok || [];
      AppState.globalOrders = res.orders || [];

      idbSet('cached_stok', AppState.globalStok);
      idbSet('cached_orders', AppState.globalOrders);

      recordFreshness();
      renderOrders();
      filterStok(true);
      runNotificationScan(!announce);
      if (showSpinner) showToast("Tersinkron", "Data pesanan dan stok diperbarui.");
    } else {
      throw new Error((res && res.message) || "Gagal memuat data dari Spreadsheet.");
    }
  } catch (err) {
    setSyncIndicator(false);
    const cachedS = await idbGet('cached_stok', null);
    const cachedO = await idbGet('cached_orders', null);
    if (cachedS) AppState.globalStok = cachedS;
    if (cachedO) AppState.globalOrders = cachedO;
    renderOrders();
    filterStok(true);
    if (showSpinner) showToast("Mode Offline", "Menampilkan data lokal tersimpan.");
  }
}

function recordFreshness() {
  const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const stokStamp = document.getElementById('stokFreshnessStamp');
  if (stokStamp) stokStamp.innerText = `Sinkron ${timeStr}`;
}

function startLiveClock() {
  setInterval(() => {
    const stamp = document.getElementById('headerSyncTimestamp');
    if (stamp) {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      stamp.innerText = `${h}:${m}:${s} WIB`;
    }
  }, 1000);
}

function getLowStockIds() {
  const ids = new Set();
  (AppState.globalStok || []).forEach(it => {
    if ((Number(it.stok) || 0) <= 20) ids.add(String(it.id).trim());
  });
  return ids;
}

function updateStokBadge() {
  const badge = document.getElementById('tabStokBadge');
  if (!badge) return;
  const low = getLowStockIds();
  const count = low.size;
  if (count > 0) {
    badge.innerText = count > 99 ? '99+' : String(count);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function loadNotificationSnapshot() {
  const o = safeStorageGet('warehouse_seen_orders', null);
  const s = safeStorageGet('warehouse_seen_lowstock', null);
  if (Array.isArray(o)) AppState.lastSeenOrderIds = new Set(o);
  if (Array.isArray(s)) AppState.lastSeenLowStock = new Set(s);
}

function persistNotificationSnapshot() {
  safeStorageSet('warehouse_seen_orders', [...AppState.lastSeenOrderIds]);
  safeStorageSet('warehouse_seen_lowstock', [...AppState.lastSeenLowStock]);
  safeStorageSet('warehouse_printed_orders', [...AppState.printedOrderIds]);
}

function normalizePrintStatus(order) {
  if (!order) return 'Belum di Print';
  if (order.statusPrint) {
    const s = String(order.statusPrint).trim().toLowerCase();
    if (s.includes('sudah') || s.includes('printed') || s.includes('selesai')) {
      return 'Sudah di Print';
    }
    return 'Belum di Print';
  }
  const st = String(order.status || '').toLowerCase();
  if (st === 'selesai' || st === 'dikirim' || AppState.printedOrderIds.has(String(order.idPesanan).trim())) {
    return 'Sudah di Print';
  }
  return 'Belum di Print';
}

async function setOrderPrintStatus(orderIds, newPrintStatus) {
  const ids = Array.isArray(orderIds) ? orderIds : [orderIds];
  if (ids.length === 0) return;

  ids.forEach(id => {
    const cleanId = String(id).trim();
    if (newPrintStatus === 'Sudah di Print') {
      AppState.printedOrderIds.add(cleanId);
    } else {
      AppState.printedOrderIds.delete(cleanId);
    }

    const order = (AppState.globalOrders || []).find(o => String(o.idPesanan).trim() === cleanId);
    if (order) {
      order.statusPrint = newPrintStatus;
      const payload = {
        sheetName: order.sheetName,
        idPesanan: order.idPesanan,
        statusPrint: newPrintStatus
      };

      if (navigator.onLine) {
        fetchAPI('updateStatusPrint', payload).catch(() => {
          enqueueOfflineAction(payload, 'updateStatusPrint');
        });
      } else {
        enqueueOfflineAction(payload, 'updateStatusPrint');
      }
    }
  });

  persistNotificationSnapshot();
  idbSet('cached_orders', AppState.globalOrders);
  renderOrders();
}

function toggleOrderPrintStatusDirect(orderId, e) {
  if (e) e.stopPropagation();
  const order = (AppState.globalOrders || []).find(o => String(o.idPesanan).trim() === String(orderId).trim());
  if (!order) return;
  const current = normalizePrintStatus(order);
  const next = current === 'Sudah di Print' ? 'Belum di Print' : 'Sudah di Print';
  setOrderPrintStatus(orderId, next);
  showToast("Status Print Diubah", `#${orderId} -> ${next}`);
}

function runNotificationScan(isInitialLoad = false) {
  updateStokBadge();
  const currentOrders = AppState.globalOrders || [];
  const currentOrderIds = new Set(currentOrders.map(o => String(o.idPesanan).trim()).filter(Boolean));

  if (isInitialLoad) {
    AppState.lastSeenOrderIds = currentOrderIds;
    currentOrders.forEach(o => {
      if (normalizePrintStatus(o) === 'Sudah di Print') {
        AppState.printedOrderIds.add(String(o.idPesanan).trim());
      }
    });
    persistNotificationSnapshot();
    return;
  }

  // Filter unprinted orders specifically targeted in Column K
  const unprintedOrders = currentOrders.filter(o => {
    const st = String(o.status || '').toLowerCase();
    if (st === 'dibatalkan') return false;
    const cleanId = String(o.idPesanan).trim();
    const printStatus = normalizePrintStatus(o);
    return printStatus === 'Belum di Print' && !AppState.inFlightPrintIds.has(cleanId);
  });

  // Notify incoming orders
  const freshOrderIds = [...currentOrderIds].filter(id => !AppState.lastSeenOrderIds.has(id));
  if (freshOrderIds.length > 0) {
    const freshOrders = currentOrders.filter(o => freshOrderIds.includes(String(o.idPesanan).trim()));
    const n = freshOrders.length;
    const sample = freshOrders[0] || {};
    const title = n === 1 ? `Pesanan Baru #${sample.idPesanan || ''}` : `${n} Pesanan Baru Masuk`;
    const msg = n === 1 ? `Toko: ${sample.namaToko || '-'}` : `Ada ${n} pesanan baru di antrean.`;
    
    if (!AppState.notifMuted) {
      showToast(title, msg);
      const snd = document.getElementById('notifSound');
      if (snd) snd.play().catch(() => {});
    }
  }
  AppState.lastSeenOrderIds = currentOrderIds;

  // Execute seamless Bluetooth Auto-Print without confirmation
  if (AppState.autoPrintBluetooth && unprintedOrders.length > 0) {
    unprintedOrders.forEach(o => AppState.inFlightPrintIds.add(String(o.idPesanan).trim()));

    if (AppState.btCharacteristic && AppState.btDevice?.gatt?.connected) {
      showToast("Auto-Print", `Mencetak otomatis ${unprintedOrders.length} pesanan belum diprint ke Minipos...`);
      printThermalBluetooth(unprintedOrders, true);
    } else if (AppState.btDevice) {
      reconnectBluetoothGatt().then(connected => {
        if (connected && AppState.btCharacteristic) {
          showToast("Auto-Print", `Mencetak otomatis ${unprintedOrders.length} pesanan...`);
          printThermalBluetooth(unprintedOrders, true);
        } else {
          unprintedOrders.forEach(o => AppState.inFlightPrintIds.delete(String(o.idPesanan).trim()));
        }
      });
    } else {
      unprintedOrders.forEach(o => AppState.inFlightPrintIds.delete(String(o.idPesanan).trim()));
    }
  }

  // Low stock alerts
  if (!AppState.notifMuted) {
    const currentLow = getLowStockIds();
    const newlyLow = [...currentLow].filter(id => !AppState.lastSeenLowStock.has(id));
    if (newlyLow.length > 0) {
      const names = newlyLow.slice(0, 3).map(id => {
        const it = (AppState.globalStok || []).find(x => String(x.id).trim() === id);
        return it ? (it.nama || it.id) : id;
      });
      const extra = newlyLow.length - names.length;
      const tail = extra > 0 ? ` +${extra} lainnya` : '';
      const title = newlyLow.length === 1 ? 'Stok Menipis' : `${newlyLow.length} Stok Menipis`;
      showToast(title, names.join(', ') + tail, false);
    }
    AppState.lastSeenLowStock = currentLow;
  }

  persistNotificationSnapshot();
}

async function reconnectBluetoothGatt() {
  if (!AppState.btDevice) return false;
  try {
    const server = await AppState.btDevice.gatt.connect();
    const services = await server.getPrimaryServices();
    let char = null;
    for (const service of services) {
      try {
        const chars = await service.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            char = c;
            break;
          }
        }
        if (char) break;
      } catch (e) {}
    }
    if (char) {
      AppState.btServer = server;
      AppState.btCharacteristic = char;
      updateBluetoothButtonUI();
      return true;
    }
  } catch (e) {
    console.warn("GATT auto-reconnect failed:", e);
  }
  return false;
}

function simulasiOrderBaruAutoPrint() {
  const dummyId = `SIM-${Math.floor(1000 + Math.random() * 9000)}`;
  const dummyOrder = {
    idPesanan: dummyId,
    namaToko: 'TOKO SIMULASI AUTO-PRINT',
    tanggal: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
    picker: AppState.namaPicker || 'Operator Floor',
    catatan: 'Uji coba Auto-Print & Autocut berhasil!',
    items: [
      { idBarang: 'SKU-TES-01', namaBarang: 'Produk Uji Coba Cepat', jumlah: 3 },
      { idBarang: 'SKU-TES-02', namaBarang: 'Karton Pengaman Tambahan', jumlah: 1 }
    ]
  };

  if (!AppState.btCharacteristic || !AppState.btDevice?.gatt?.connected) {
    showToast("Minipos Belum Konek", "Sambungkan printer via tombol 'Hubungkan Minipos' di bar atas terlebih dahulu.", true);
    return;
  }

  showToast("Auto-Print Terpicu", `Mencetak order #${dummyId} tanpa konfirmasi...`);
  printThermalBluetooth([dummyOrder], true);
}

function setNotifMuted(muted) {
  AppState.notifMuted = muted;
  safeStorageSet('warehouse_notif_muted', muted);
  if (muted) showToast('Notifikasi Dimatikan', 'Peringatan stok & pesanan baru nonaktif.');
  else { showToast('Notifikasi Aktif', 'Peringatan suara & toast diaktifkan.'); }
}

function toggleNotifMute(isChecked) {
  setNotifMuted(!isChecked);
}

function syncNotifToggleUI() {
  const cb = document.getElementById('toggleNotifMute');
  if (cb) cb.checked = !AppState.notifMuted;
  const apCb = document.getElementById('toggleAutoPrintBluetooth');
  if (apCb) apCb.checked = Boolean(AppState.autoPrintBluetooth);
}

function toggleAutoPrintSwitch(checked) {
  AppState.autoPrintBluetooth = checked;
  safeStorageSet('warehouse_autoprint_bt', checked);
  showToast("Auto-Print Bluetooth", checked ? "Aktif: Pesanan baru akan langsung dicetak & dipotong otomatis." : "Nonaktif: Pesanan dicetak manual.");
}

function setOrderFilter(filterName) {
  AppState.currentOrderFilter = filterName;
  document.querySelectorAll('.filter-order-btn').forEach(btn => {
    const f = btn.getAttribute('data-filter');
    if (f === filterName) {
      btn.className = 'filter-order-btn flex-1 min-w-[70px] h-8 rounded-xl bg-ios-card text-ios-text font-bold shadow-sm flex items-center justify-center gap-1 transition-all ios-press';
    } else {
      btn.className = 'filter-order-btn flex-1 min-w-[70px] h-8 rounded-xl text-ios-text-sec flex items-center justify-center gap-1 transition-all ios-press';
    }
  });
  renderOrders();
}

function formatEscPosRow(left, right, colWidth = 48) {
  const l = String(left || '');
  const r = String(right || '');
  const spaceNeeded = colWidth - l.length - r.length;
  if (spaceNeeded > 0) {
    return l + ' '.repeat(spaceNeeded) + r + '\n';
  }
  return l + '\n' + ' '.repeat(Math.max(0, colWidth - r.length)) + r + '\n';
}

function generateEscPosCommands(orders, customWidth = null) {
  const widthMode = customWidth || AppState.thermalPaperWidth || '80mm';
  const is80 = widthMode === '80mm';
  // Standar 80mm Font A: 48 kolom (576 dots), 58mm: 32 kolom (384 dots)
  const colWidth = is80 ? 48 : 32;
  const dividerThick = '='.repeat(colWidth) + '\n';
  const dividerThin  = '-'.repeat(colWidth) + '\n';
  const printTime = new Date().toLocaleString('id-ID', { 
    dateStyle: 'short', 
    timeStyle: 'medium' 
  }).replace(/\./g, ':');

  let escpos = "";

  orders.forEach(order => {
    escpos += '\x1B\x40'; // Reset & Initialize printer

    // Set lebar area fisik cetak (576 dots untuk 80mm, 384 dots untuk 58mm)
    if (is80) {
      escpos += '\x1D\x57\x40\x02'; // GS W: 576 dots width (0x0240)
      escpos += '\x1D\x4C\x00\x00'; // GS L: Margin kiri 0 dot
    } else {
      escpos += '\x1D\x57\x80\x01'; // GS W: 384 dots width (0x0180)
      escpos += '\x1D\x4C\x00\x00'; // GS L: Margin kiri 0 dot
    }

    // Header Utama (Center Alignment)
    escpos += '\x1B\x61\x01';
    escpos += '\x1B\x45\x01'; // Bold ON
    if (is80) {
      escpos += '\x1D\x21\x11'; // Double Width + Double Height
      escpos += 'DUTA ABADI\n';
      escpos += '\x1D\x21\x00'; // Ukuran Normal
      escpos += 'SURAT MANIFEST PESANAN\n';
    } else {
      escpos += 'DUTA ABADI\n';
      escpos += 'MANIFEST PENGIRIMAN\n';
    }
    escpos += '\x1B\x45\x00'; // Bold OFF

    // Informasi Pesanan (Left Alignment terstruktur)
    escpos += '\x1B\x61\x00';
    escpos += dividerThick;
    escpos += formatEscPosRow(`ID Order  : #${order.idPesanan}`, `[${order.sheetName || 'Gudang'}]`, colWidth);
    escpos += `Toko/Tujuan: ${order.namaToko}\n`;
    escpos += `Waktu Order: ${order.tanggal || '-'}\n`;
    escpos += `Waktu Cetak: ${printTime}\n`;
    if (order.picker) {
      escpos += `Petugas PK : ${order.picker}\n`;
    }
    escpos += dividerThin;

    // Header Kolom Tabel Produk
    escpos += '\x1B\x45\x01'; // Bold ON
    escpos += formatEscPosRow(is80 ? "NO  DESKRIPSI PRODUK / SKU" : "ITEM / SKU", is80 ? "KUANTITAS" : "QTY", colWidth);
    escpos += '\x1B\x45\x00'; // Bold OFF
    escpos += dividerThin;

    // Looping Daftar Item dengan nomor urut rapi & kompak
    let totalQty = 0;
    const items = order.items || [];
    items.forEach((it, idx) => {
      const qty = Number(it.jumlah) || 0;
      totalQty += qty;
      const sku = String(it.idBarang || '-').trim();
      const nama = String(it.namaBarang || '-').trim();
      const nomor = `${idx + 1}.`.padEnd(3, ' ');

      if (is80) {
        escpos += `${nomor} ${nama}\n`;
        escpos += formatEscPosRow(`    SKU: ${sku}`, `${qty} Pcs`, colWidth);
      } else {
        escpos += `${idx + 1}. ${nama.substring(0, 28)}\n`;
        escpos += formatEscPosRow(`   ${sku}`, `${qty} Pcs`, colWidth);
      }
    });

    // Total Ringkasan
    escpos += dividerThin;
    escpos += '\x1B\x45\x01'; // Bold ON
    escpos += formatEscPosRow(`TOTAL ITEM FISIK (${items.length} SKU):`, `${totalQty} Pcs`, colWidth);
    escpos += '\x1B\x45\x00'; // Bold OFF
    escpos += dividerThick;

    // Catatan Khusus bila ada
    if (order.catatan) {
      escpos += `Catatan: ${order.catatan}\n`;
      escpos += dividerThin;
    }

    // Penutup / Footer
    escpos += '\x1B\x61\x01'; // Center
    escpos += '*** DOKUMEN MANIFEST RESMI GUDANG ***\n';
    escpos += 'Harap periksa fisik barang sebelum serah terima\n';
    escpos += '\x1B\x61\x00'; // Reset ke Left

    // Feed baris secukupnya agar teks melewati pisau pemotong, lalu AUTOCUT
    escpos += '\x0A\x0A\x0A\x0A'; 
    escpos += '\x1D\x56\x00'; // Full cut command (GS V 0)
  });

  return escpos;
}

function renderOrders() {
  const container = document.getElementById('orderContainer');
  if (!container) return;

  const myName = String(AppState.namaPicker || '').trim().toLowerCase();
  let orders = [...(AppState.globalOrders || [])];

  let cSemua = orders.length;
  let cSaya = 0, cPending = 0, cDiproses = 0, cDikirim = 0, cSelesai = 0, cBatal = 0;

  orders.forEach(o => {
    const st = String(o.status || 'Pending').toLowerCase();
    const p = String(o.picker || '').toLowerCase();
    if (p && myName && p === myName && st === 'diproses') cSaya++;
    if (st === 'pending') cPending++;
    else if (st === 'diproses') cDiproses++;
    else if (st === 'dikirim') cDikirim++;
    else if (st === 'selesai') cSelesai++;
    else if (st === 'dibatalkan') cBatal++;
  });

  const setCnt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  setCnt('cntFilterSemua', cSemua);
  setCnt('cntFilterSaya', cSaya);
  setCnt('cntFilterPending', cPending);
  setCnt('cntFilterDiproses', cDiproses);
  setCnt('cntFilterDikirim', cDikirim);
  setCnt('cntFilterSelesai', cSelesai);
  setCnt('cntFilterDibatalkan', cBatal);

  const subEl = document.getElementById('orderCountSubtitle');
  if (subEl) subEl.innerText = `${cPending} Pending • ${cDiproses} Sedang Disiapkan`;

  if (AppState.currentOrderFilter === 'Tugas Saya') {
    orders = orders.filter(o => String(o.status || '').toLowerCase() === 'diproses' && String(o.picker || '').toLowerCase() === myName);
  } else if (AppState.currentOrderFilter !== 'Semua') {
    orders = orders.filter(o => String(o.status || 'Pending').toLowerCase() === AppState.currentOrderFilter.toLowerCase());
  }

  const searchVal = (document.getElementById('searchOrder')?.value || '').toLowerCase().trim();
  if (searchVal) {
    const keywords = searchVal.split(/\s+/).filter(Boolean);
    orders = orders.filter(o => {
      const haystack = `${o.idPesanan || ''} ${o.namaToko || ''} ${(o.items || []).map(i => `${i.idBarang} ${i.namaBarang}`).join(' ')}`.toLowerCase();
      return keywords.every(k => haystack.includes(k));
    });
  }

  if (orders.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-ios-text-ter flex flex-col items-center justify-center bg-ios-card rounded-2xl border border-ios-separator/60">
        <span class="material-symbols-outlined text-[40px] text-ios-text-ter mb-1">inbox</span>
        <span class="font-bold text-xs text-ios-text">Tidak ada pesanan cocok</span>
        <p class="text-[11px] text-ios-text-ter mt-0.5">Filter atau kata kunci saat ini kosong.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = orders.map(order => renderSingleOrderCard(order, myName)).join('');
  updateBatchBarUI();
  Motion.staggerCards('.order-card-tile');
}

function renderSingleOrderCard(order, myName) {
  const id = escapeHTML(order.idPesanan);
  const store = escapeHTML(order.namaToko);
  const status = order.status || 'Pending';
  const picker = String(order.picker || '').trim();
  const isSelected = AppState.selectedOrderIds.has(order.idPesanan);
  const items = order.items || [];

  const printStatus = normalizePrintStatus(order);
  const isPrinted = printStatus === 'Sudah di Print';
  const printStatusBadge = isPrinted
    ? `<button onclick="window.WarehouseApp.toggleOrderPrintStatusDirect('${order.idPesanan}', event)" class="px-2 py-0.5 rounded-full bg-ios-green/15 text-ios-green hover:bg-ios-green/25 text-[9.5px] font-bold flex items-center gap-1 border border-ios-green/30 ios-press" type="button" title="Klik untuk ubah ke Belum di Print"><span class="material-symbols-outlined text-[12px]">done_all</span><span>Sudah Print</span></button>`
    : `<button onclick="window.WarehouseApp.toggleOrderPrintStatusDirect('${order.idPesanan}', event)" class="px-2 py-0.5 rounded-full bg-ios-orange/15 text-ios-orange hover:bg-ios-orange/25 text-[9.5px] font-bold flex items-center gap-1 border border-ios-orange/30 ios-press" type="button" title="Klik untuk ubah ke Sudah di Print"><span class="material-symbols-outlined text-[12px]">print</span><span>Belum Print</span></button>`;

  let totalTarget = 0, totalSiap = 0;
  items.forEach(it => {
    totalTarget += Number(it.jumlah) || 0;
    totalSiap += Number(it.disiapkan) || 0;
  });
  const pct = totalTarget > 0 ? Math.min(100, Math.floor((totalSiap / totalTarget) * 100)) : 0;

  let statusBadge = '';
  if (status === 'Pending') statusBadge = `<span class="px-2.5 py-1 rounded-full bg-ios-card-sub border border-ios-separator/60 text-ios-text text-[10px] font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">hourglass_top</span>Pending</span>`;
  else if (status === 'Diproses') statusBadge = `<span class="px-2.5 py-1 rounded-full bg-ios-blue/15 text-ios-blue text-[10px] font-bold flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-ios-blue animate-pulse"></span>Diproses</span>`;
  else if (status === 'Dikirim') statusBadge = `<span class="px-2.5 py-1 rounded-full bg-ios-orange/15 text-ios-orange text-[10px] font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">local_shipping</span>Dikirim</span>`;
  else if (status === 'Selesai') statusBadge = `<span class="px-2.5 py-1 rounded-full bg-ios-green/15 text-ios-green text-[10px] font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">check_circle</span>Selesai</span>`;
  else statusBadge = `<span class="px-2.5 py-1 rounded-full bg-ios-red/15 text-ios-red text-[10px] font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">cancel</span>Batal</span>`;

  let actionBtns = '';
  const isMyTask = picker && myName && picker.toLowerCase() === myName.toLowerCase();

  if (status === 'Pending') {
    actionBtns = `
      <button onclick="window.WarehouseApp.ambilTugasPicker('${order.idPesanan}')" class="h-8 px-3.5 rounded-xl bg-ios-blue text-white text-xs font-bold ios-press shadow-sm" type="button">
        Ambil Tugas
      </button>
    `;
  } else if (status === 'Diproses') {
    if (isMyTask) {
      actionBtns = `
        <div class="flex items-center gap-1.5">
          <button onclick="window.WarehouseApp.konfirmasiBatalTugas('${order.idPesanan}')" class="h-8 px-2.5 rounded-xl bg-ios-card-sub text-ios-red text-xs border border-ios-separator/60 ios-press" type="button" title="Batalkan">
            <span class="material-symbols-outlined text-[15px]">restart_alt</span>
          </button>
          <button onclick="window.WarehouseApp.bukaPickingRoom('${order.idPesanan}')" class="h-8 px-3.5 rounded-xl bg-ios-green text-white text-xs font-bold flex items-center gap-1 shadow-sm ios-press" type="button">
            <span class="material-symbols-outlined text-[15px]">edit_document</span>
            <span>Lanjutkan</span>
          </button>
        </div>
      `;
    } else {
      actionBtns = `
        <button onclick="window.WarehouseApp.konfirmasiAmbilAlih('${order.idPesanan}')" class="h-8 px-3 rounded-xl bg-ios-card-sub text-ios-blue text-xs font-bold border border-ios-separator/60 ios-press" type="button">
          Ambil Alih
        </button>
      `;
    }
  }

  let adminBtn = '';
  if (isAdmin() && status !== 'Selesai') {
    adminBtn = `
      <button onclick="window.WarehouseApp.openStatusModal('${escapeHTML(order.sheetName)}', '${order.idPesanan}')" class="h-8 px-2.5 rounded-xl bg-ios-card-sub text-ios-text text-xs border border-ios-separator/60 ios-press" type="button" title="Ubah Status">
        <span class="material-symbols-outlined text-[15px]">tune</span>
      </button>
    `;
  }

  return `
    <div class="order-card-tile rounded-2xl bg-ios-card border ${isSelected ? 'border-ios-blue ring-2 ring-ios-blue/30' : 'border-ios-separator/60'} shadow-ios-card dark:shadow-ios-card-dark flex flex-col justify-between overflow-hidden">
      <div class="p-3.5 sm:p-4 flex flex-col gap-3">
        <div class="flex items-start justify-between gap-2.5">
          <div class="flex items-start gap-2.5 min-w-0">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="window.WarehouseApp.toggleOrderSelection('${order.idPesanan}', this.checked)" class="w-4 h-4 mt-0.5 accent-ios-blue cursor-pointer shrink-0" />
            <div class="flex flex-col min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-mono font-extrabold text-xs text-ios-blue">#${id}</span>
                <span class="text-[9.5px] text-ios-text-ter font-semibold px-2 py-0.2 rounded-md bg-ios-card-sub border border-ios-separator/40 truncate max-w-[130px]">${escapeHTML(order.sheetName || 'Toko')}</span>
                ${printStatusBadge}
              </div>
              <span class="font-bold text-xs sm:text-sm text-ios-text truncate mt-0.5">${store}</span>
              <span class="text-[10.5px] text-ios-text-ter mt-0.5">${escapeHTML(order.tanggal || '')}</span>
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            ${statusBadge}
            <button onclick="window.WarehouseApp.openPrintModal('${order.idPesanan}')" class="w-8 h-8 rounded-full bg-ios-card-sub text-ios-blue flex items-center justify-center border border-ios-separator/40 ios-press" type="button" title="Cetak Stiker A4">
              <span class="material-symbols-outlined text-[16px]">print</span>
            </button>
            <button onclick="window.WarehouseApp.cetakThermal('${order.idPesanan}')" class="w-8 h-8 rounded-full bg-ios-orange/15 text-ios-orange flex items-center justify-center border border-ios-orange/30 ios-press" type="button" title="Cetak Struk Minipos">
              <span class="material-symbols-outlined text-[16px]">receipt_long</span>
            </button>
          </div>
        </div>

        <!-- Items List -->
        <div class="rounded-xl bg-ios-card-sub p-2 border border-ios-separator/40">
          <table class="w-full text-left text-xs">
            <tbody>
              ${items.map(it => {
                const req = Number(it.jumlah) || 0;
                const done = Number(it.disiapkan) || 0;
                const isFull = done >= req && req > 0;
                return `
                  <tr class="border-b border-ios-separator/20 last:border-0">
                    <td class="py-1.5 pr-2 min-w-0">
                      <span class="font-mono font-bold text-ios-blue text-[10.5px] block leading-none">${escapeHTML(it.idBarang)}</span>
                      <span class="text-ios-text text-xs truncate max-w-[190px] sm:max-w-[320px] block leading-tight mt-0.5">${escapeHTML(it.namaBarang)}</span>
                    </td>
                    <td class="py-1.5 text-right font-mono whitespace-nowrap pl-2">
                      <span class="${isFull ? 'text-ios-green font-bold' : 'text-ios-text-ter font-medium'}">${done} / ${req} Pcs</span>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- Progress Line -->
        <div class="flex flex-col gap-1">
          <div class="w-full h-1.5 rounded-full bg-ios-separator/50 overflow-hidden">
            <div class="h-full bg-ios-green transition-all duration-300" style="width: ${pct}%;"></div>
          </div>
          <div class="flex justify-between text-[10.5px] text-ios-text-ter font-medium">
            <span>Siap: <strong class="text-ios-text font-mono">${totalSiap}/${totalTarget} Pcs</strong></span>
            <span class="font-mono text-ios-blue font-bold">${pct}%</span>
          </div>
        </div>

        ${order.catatan ? `
          <div class="p-2.5 rounded-xl bg-ios-card-sub text-[11px] text-ios-text-sec border border-ios-separator/30">
            <strong class="text-ios-orange">Catatan:</strong> ${escapeHTML(order.catatan)}
          </div>
        ` : ''}
      </div>

      <div class="px-3.5 sm:px-4 py-2.5 bg-ios-card-sub/60 flex items-center justify-between gap-2 border-t border-ios-separator/40 flex-wrap">
        <span class="text-[11px] text-ios-text-ter truncate max-w-[160px]">
          Picker: <strong class="text-ios-text">${escapeHTML(picker || '-')}</strong>
        </span>
        <div class="flex items-center gap-1.5 shrink-0 ml-auto">
          ${adminBtn}
          ${actionBtns}
        </div>
      </div>
    </div>
  `;
}

function toggleOrderSelection(orderId, checked) {
  if (checked) AppState.selectedOrderIds.add(orderId);
  else AppState.selectedOrderIds.delete(orderId);
  updateBatchBarUI();
}

function toggleSelectAllOrders() {
  if (AppState.selectedOrderIds.size > 0) {
    AppState.selectedOrderIds.clear();
  } else {
    (AppState.globalOrders || []).forEach(o => AppState.selectedOrderIds.add(o.idPesanan));
  }
  renderOrders();
  updateBatchBarUI();
}

function clearOrderSelection() {
  AppState.selectedOrderIds.clear();
  renderOrders();
  updateBatchBarUI();
}

function updateBatchBarUI() {
  const bar = document.getElementById('batchSelectionBar');
  const countTxt = document.getElementById('batchSelectedCount');
  const count = AppState.selectedOrderIds.size;
  if (bar && countTxt) {
    bar.classList.toggle('hidden', count === 0);
    countTxt.innerText = count;
  }
}

function handleOrderInput() {
  renderOrders();
}

function handleStokInput() {
  filterStok(false);
}

function setStokStatusFilter(filterKey) {
  AppState.currentStokStatusFilter = filterKey;
  const chips = {
    all: document.getElementById('btnFilterStokAll'),
    optimal: document.getElementById('btnFilterStokOptimal'),
    restok: document.getElementById('btnFilterStokRestok'),
    habis: document.getElementById('btnFilterStokHabis')
  };

  for (const [key, btn] of Object.entries(chips)) {
    if (!btn) continue;
    if (key === filterKey) {
      btn.className = 'stok-filter-chip h-7 px-3 rounded-full bg-ios-card text-ios-text font-bold border border-ios-separator/70 shadow-sm shrink-0 ios-press';
    } else {
      btn.className = 'stok-filter-chip h-7 px-3 rounded-full bg-ios-card-sub text-ios-text-sec font-semibold border border-ios-separator/40 shrink-0 ios-press';
    }
  }

  filterStok(false);
}

function openStokDetailModal(skuId) {
  const item = (AppState.globalStok || []).find(it => String(it.id).trim() === String(skuId).trim());
  if (!item) return;

  const codeEl = document.getElementById('detailSkuCode');
  const nameEl = document.getElementById('detailSkuName');
  const statusEl = document.getElementById('detailSkuStatus');
  const qtyEl = document.getElementById('detailSkuQty');
  const valuasiEl = document.getElementById('detailSkuValuasi');
  const pricingBox = document.getElementById('detailPricingBox');
  const valuasiRow = document.getElementById('detailValuasiRow');
  const retEl = document.getElementById('detailSkuRetail');
  const groEl = document.getElementById('detailSkuGrosir');
  const hppEl = document.getElementById('detailSkuHpp');
  const discEl = document.getElementById('detailSkuDiskon');

  const qty = Number(item.stok) || 0;
  const hpp = Number(item.hpp) || 0;
  const totalVal = qty * hpp;

  if (codeEl) codeEl.innerText = item.id;
  if (nameEl) nameEl.innerText = item.nama;
  if (qtyEl) qtyEl.innerText = `${qty} Unit`;
  if (valuasiEl) valuasiEl.innerText = formatRupiah(totalVal);

  if (statusEl) {
    if (qty <= 0) {
      statusEl.innerText = 'Habis';
      statusEl.className = 'px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 bg-ios-red/15 text-ios-red';
    } else if (qty <= 20) {
      statusEl.innerText = 'Restok';
      statusEl.className = 'px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 bg-ios-orange/15 text-ios-orange';
    } else {
      statusEl.innerText = 'Aman';
      statusEl.className = 'px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 bg-ios-green/15 text-ios-green';
    }
  }

  const isPickerRole = isPicker();
  if (pricingBox) pricingBox.style.display = isPickerRole ? 'none' : 'flex';
  if (valuasiRow) valuasiRow.style.display = isPickerRole ? 'none' : 'block';

  if (!isPickerRole) {
    if (retEl) retEl.innerText = formatRupiah(item.hargaRetail);
    if (groEl) groEl.innerText = formatRupiah(item.hargaGrosir);
    if (hppEl) hppEl.innerText = formatRupiah(item.hpp);
    if (discEl) discEl.innerText = formatPersen(item.diskon);
  }

  openModal('modalStokDetail');
}

function filterStok(updateKPI = false) {
  const rawInput = (document.getElementById('searchStok')?.value || '').toLowerCase().trim();
  const hideEmpty = document.getElementById('toggleEmptyStock')?.checked || false;
  const keywords = rawInput.split(/\s+/).filter(Boolean);

  let hasil = AppState.globalStok || [];

  if (updateKPI) {
    let totalValuasi = 0, countOptimal = 0, countPerluRestok = 0, countHabis = 0;
    (AppState.globalStok || []).forEach(item => {
      const qty = Number(item.stok) || 0;
      const hpp = Number(item.hpp) || 0;
      totalValuasi += (qty * hpp);
      if (qty > 20) countOptimal++;
      else if (qty > 0 && qty <= 20) countPerluRestok++;
      else if (qty <= 0) countHabis++;
    });

    Motion.counter('metricValuasiHpp', totalValuasi, true);
    Motion.counter('metricStokOptimal', countOptimal, false, ' SKU');
    Motion.counter('metricPerluRestok', countPerluRestok, false, ' SKU');
    Motion.counter('metricHabisTotal', countHabis, false, ' SKU');
  }

  const badgeCnt = document.getElementById('stokCountBadge');
  if (badgeCnt) badgeCnt.innerText = `${(AppState.globalStok || []).length} SKU Terdata`;

  if (hideEmpty) {
    hasil = hasil.filter(item => (Number(item.stok) || 0) > 0);
  }

  if (AppState.currentStokStatusFilter === 'optimal') {
    hasil = hasil.filter(item => (Number(item.stok) || 0) > 20);
  } else if (AppState.currentStokStatusFilter === 'restok') {
    hasil = hasil.filter(item => {
      const q = Number(item.stok) || 0;
      return q > 0 && q <= 20;
    });
  } else if (AppState.currentStokStatusFilter === 'habis') {
    hasil = hasil.filter(item => (Number(item.stok) || 0) <= 0);
  }

  if (keywords.length > 0) {
    hasil = hasil.filter(item => {
      const haystack = `${item.id || ''} ${item.nama || ''}`.toLowerCase();
      return keywords.every(k => haystack.includes(k));
    });
  }

  renderStokUI(hasil);
}

function renderStokUI(items) {
  const container = document.getElementById('stokContainer');
  if (!container) return;

  const isPickerRole = isPicker();

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-ios-text-ter flex flex-col items-center justify-center bg-ios-card rounded-2xl border border-ios-separator/60">
        <span class="material-symbols-outlined text-[36px] mb-1">search_off</span>
        <span class="font-bold text-xs text-ios-text">Tidak ada data stok yang cocok</span>
        <p class="text-[11px] text-ios-text-ter mt-0.5">Coba gunakan kata kunci SKU atau nama lain.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.slice(0, 150).map(item => {
    const qty = Number(item.stok) || 0;
    let badgeColor = 'bg-ios-green/15 text-ios-green border-ios-green/30';
    if (qty <= 0) {
      badgeColor = 'bg-ios-red/15 text-ios-red border-ios-red/30';
    } else if (qty <= 20) {
      badgeColor = 'bg-ios-orange/15 text-ios-orange border-ios-orange/30';
    }

    const adminPills = !isPickerRole ? `
      <div class="pt-1.5 border-t border-ios-separator/30 flex items-center justify-between text-[9.5px] sm:text-[10.5px] font-mono text-ios-text-ter">
        <span class="text-ios-text font-bold truncate">${formatRupiah(item.hargaRetail)}</span>
        <span class="text-ios-purple font-bold shrink-0">${formatPersen(item.diskon)}</span>
      </div>
    ` : '';

    return `
      <div onclick="window.WarehouseApp.openStokDetailModal('${escapeHTML(item.id)}')" class="stok-card-tile p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-ios-card border border-ios-separator/60 shadow-ios-card dark:shadow-ios-card-dark flex flex-col justify-between gap-1.5 hover:border-ios-blue/40 transition-all ios-press cursor-pointer min-h-[96px]">
        <div class="flex items-center justify-between gap-1">
          <span class="font-mono font-extrabold text-[10px] sm:text-xs text-ios-blue bg-ios-card-sub px-1.5 py-0.5 rounded border border-ios-separator/40 truncate max-w-[85px] sm:max-w-[120px]">
            ${escapeHTML(item.id)}
          </span>
          <span class="px-1.5 py-0.5 rounded text-[9.5px] sm:text-[10px] font-bold border shrink-0 ${badgeColor}">
            ${qty} Pcs
          </span>
        </div>

        <div class="flex flex-col min-w-0 my-0.5">
          <span class="font-bold text-[11px] sm:text-xs text-ios-text line-clamp-2 leading-snug">
            ${escapeHTML(item.nama)}
          </span>
        </div>

        ${adminPills}
      </div>
    `;
  }).join('');

  Motion.staggerCards('.stok-card-tile');
}

function downloadStokCSV() {
  if (isPicker()) return;
  if (!AppState.globalStok || AppState.globalStok.length === 0) {
    showToast("Data Kosong", "Belum ada data untuk diunduh.", true);
    return;
  }

  const headers = ["No", "Kode SKU", "Nama Barang", "Harga Retail", "Harga Grosir", "HPP", "Diskon", "Sisa Stok"];
  const rows = AppState.globalStok.map((it, idx) => [
    idx + 1,
    `"${(it.id || '').replace(/"/g, '""')}"`,
    `"${(it.nama || '').replace(/"/g, '""')}"`,
    it.hargaRetail || 0,
    it.hargaGrosir || 0,
    it.hpp || 0,
    `"${(it.diskon || '').replace(/"/g, '""')}"`,
    it.stok || 0
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Stok_Gudang_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function ambilTugasPicker(orderId) {
  if (!AppState.namaPicker) {
    openModal('modalLoginAwal');
    return;
  }

  const order = AppState.globalOrders.find(o => o.idPesanan === orderId);
  if (!order) return;

  if ((order.status || 'Pending') !== 'Pending' || (order.picker && order.picker !== AppState.namaPicker)) {
    showToast("Tugas Tidak Tersedia", "Hanya pesanan Pending yang dapat diambil.", true);
    return;
  }

  order.status = 'Diproses';
  order.picker = AppState.namaPicker;
  (order.items || []).forEach(it => {
    if (it.disiapkan === undefined || it.disiapkan === null) it.disiapkan = 0;
  });

  renderOrders();
  idbSet('cached_orders', AppState.globalOrders);

  const payload = {
    sheetName: order.sheetName,
    idPesanan: order.idPesanan,
    pickerName: AppState.namaPicker,
    itemsProgress: JSON.stringify(order.items || []),
    isSelesai: 'false'
  };

  if (navigator.onLine) {
    fetchAPI('updateProgressPesanan', payload).catch(() => enqueueOfflineAction(payload, 'updateProgressPesanan'));
  } else {
    enqueueOfflineAction(payload, 'updateProgressPesanan');
  }

  showToast("Tugas Diambil", `Mulai penyiapan #${order.idPesanan}`);
  bukaPickingRoom(orderId);
}

function bukaPickingRoom(orderId) {
  const order = AppState.globalOrders.find(o => o.idPesanan === orderId);
  if (!order) return;

  AppState.activePickingOrder = order;
  switchMainTab('picking');

  const titleEl = document.getElementById('pickingOrderHeaderTitle');
  if (titleEl) titleEl.innerText = `#${escapeHTML(order.idPesanan)} - ${escapeHTML(order.namaToko)}`;

  renderPickingItems();
  kalkulasiPickingProgress();
}

function kembaliDariPicking() {
  AppState.activePickingOrder = null;
  switchMainTab('order');
}

function renderPickingItems() {
  const container = document.getElementById('pickingItemsListContainer');
  if (!container || !AppState.activePickingOrder) return;

  container.innerHTML = (AppState.activePickingOrder.items || []).map((item, idx) => {
    const target = Number(item.jumlah) || 0;
    const siap = Number(item.disiapkan) || 0;
    const isDone = siap >= target && target > 0;

    return `
      <div class="picking-item-tile p-3.5 sm:p-4 rounded-2xl bg-ios-card border ${isDone ? 'border-ios-green/40 bg-ios-green/5' : 'border-ios-separator/60'} shadow-sm flex items-center justify-between gap-3">
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="font-mono font-bold text-xs text-ios-blue">${escapeHTML(item.idBarang)}</span>
            ${isDone ? '<span class="px-2 py-0.2 rounded-md bg-ios-green text-white text-[9px] font-bold">LENGKAP</span>' : ''}
          </div>
          <span class="font-bold text-xs sm:text-sm text-ios-text truncate mt-1">${escapeHTML(item.namaBarang)}</span>
          <span class="text-xs text-ios-text-ter mt-0.5">Target: <strong class="text-ios-text font-mono">${target} Pcs</strong></span>
        </div>

        <div class="flex items-center rounded-xl bg-ios-card-sub border border-ios-separator/60 overflow-hidden shrink-0 shadow-inner">
          <button onclick="window.WarehouseApp.adjustPickingItemQty(${idx}, -1)" class="w-9 h-9 flex items-center justify-center font-bold text-base text-ios-text hover:bg-ios-separator/40 ios-press" type="button">-</button>
          <input type="number" min="0" max="${target}" value="${siap}" onchange="window.WarehouseApp.setPickingItemQtyDirect(${idx}, this.value)" class="w-11 h-9 text-center font-mono font-bold text-xs bg-transparent text-ios-blue focus:outline-none" />
          <button onclick="window.WarehouseApp.adjustPickingItemQty(${idx}, 1)" class="w-9 h-9 flex items-center justify-center font-bold text-base text-ios-blue hover:bg-ios-separator/40 ios-press" type="button">+</button>
        </div>
      </div>
    `;
  }).join('');

  Motion.staggerCards('.picking-item-tile');
}

function adjustPickingItemQty(idx, delta) {
  if (!AppState.activePickingOrder || !AppState.activePickingOrder.items[idx]) return;
  const item = AppState.activePickingOrder.items[idx];
  const target = Number(item.jumlah) || 0;
  let current = Number(item.disiapkan) || 0;
  current = Math.max(0, Math.min(target, current + delta));
  item.disiapkan = current;

  renderPickingItems();
  kalkulasiPickingProgress();
}

function setPickingItemQtyDirect(idx, val) {
  if (!AppState.activePickingOrder || !AppState.activePickingOrder.items[idx]) return;
  const item = AppState.activePickingOrder.items[idx];
  const target = Number(item.jumlah) || 0;
  let num = parseInt(val, 10);
  if (isNaN(num) || num < 0) num = 0;
  if (num > target) num = target;
  item.disiapkan = num;

  renderPickingItems();
  kalkulasiPickingProgress();
}

function kalkulasiPickingProgress() {
  if (!AppState.activePickingOrder) return;
  let totalTarget = 0, totalSiap = 0, skuLengkap = 0;
  const items = AppState.activePickingOrder.items || [];

  items.forEach(it => {
    const t = Number(it.jumlah) || 0;
    const s = Number(it.disiapkan) || 0;
    totalTarget += t;
    totalSiap += s;
    if (s >= t && t > 0) skuLengkap++;
  });

  const pct = totalTarget > 0 ? Math.floor((totalSiap / totalTarget) * 100) : 0;
  const fillBar = document.getElementById('pickingOverallProgressBar');
  const summaryUnits = document.getElementById('pickingSummaryUnits');
  const summarySKU = document.getElementById('pickingSummarySKU');

  if (fillBar) fillBar.style.width = `${Math.min(100, pct)}%`;
  if (summaryUnits) summaryUnits.innerText = `${totalSiap} / ${totalTarget} Pcs`;
  if (summarySKU) summarySKU.innerText = `${skuLengkap} / ${items.length} SKU Siap`;
}

function simpanProgressPicking(tandaiSelesai = false) {
  if (!AppState.activePickingOrder) return;

  let totalTarget = 0, totalSiap = 0, skuLengkap = 0;
  const items = AppState.activePickingOrder.items || [];

  items.forEach(it => {
    const t = Number(it.jumlah) || 0;
    const s = Number(it.disiapkan) || 0;
    totalTarget += t;
    totalSiap += s;
    if (s >= t && t > 0) skuLengkap++;
  });

  if (tandaiSelesai) {
    const idEl = document.getElementById('confirmModalOrderId');
    const storeEl = document.getElementById('confirmModalStoreName');
    const skuEl = document.getElementById('confirmModalSkuSummary');
    const unitEl = document.getElementById('confirmModalUnitSummary');
    const warnEl = document.getElementById('confirmModalWarningBox');

    if (idEl) idEl.innerText = `#${AppState.activePickingOrder.idPesanan}`;
    if (storeEl) storeEl.innerText = AppState.activePickingOrder.namaToko;
    if (skuEl) skuEl.innerText = `${skuLengkap} / ${items.length} SKU`;
    if (unitEl) unitEl.innerText = `${totalSiap} / ${totalTarget} Pcs`;

    if (warnEl) warnEl.classList.toggle('hidden', totalSiap >= totalTarget);
    openModal('modalKonfirmasiSelesaiPicking');
    return;
  }

  const payload = {
    sheetName: AppState.activePickingOrder.sheetName,
    idPesanan: AppState.activePickingOrder.idPesanan,
    pickerName: AppState.namaPicker,
    itemsProgress: JSON.stringify(items),
    isSelesai: 'false'
  };

  idbSet('cached_orders', AppState.globalOrders);
  renderOrders();

  if (navigator.onLine) {
    setSyncIndicator(true);
    fetchAPI('updateProgressPesanan', payload).then(res => {
      setSyncIndicator(false);
      if (res && res.success) showToast("Tersimpan", "Progres penyiapan diperbarui.");
      else enqueueOfflineAction(payload, 'updateProgressPesanan');
    }).catch(() => {
      setSyncIndicator(false);
      enqueueOfflineAction(payload, 'updateProgressPesanan');
    });
  } else {
    enqueueOfflineAction(payload, 'updateProgressPesanan');
    showToast("Offline", "Progres disimpan di antrean lokal.");
  }
}

async function eksekusiSelesaiDanKirim() {
  closeModal('modalKonfirmasiSelesaiPicking');
  if (!AppState.activePickingOrder) return;

  AppState.activePickingOrder.status = 'Dikirim';
  const items = AppState.activePickingOrder.items || [];
  const payload = {
    sheetName: AppState.activePickingOrder.sheetName,
    idPesanan: AppState.activePickingOrder.idPesanan,
    pickerName: AppState.namaPicker,
    itemsProgress: JSON.stringify(items),
    isSelesai: 'true'
  };

  idbSet('cached_orders', AppState.globalOrders);
  renderOrders();

  if (navigator.onLine) {
    setSyncIndicator(true);
    fetchAPI('updateProgressPesanan', payload).then(() => {
      setSyncIndicator(false);
      showToast("Pesanan Dikirim", `#${AppState.activePickingOrder?.idPesanan} siap diberangkatkan.`);
      kembaliDariPicking();
    }).catch(() => {
      setSyncIndicator(false);
      enqueueOfflineAction(payload, 'updateProgressPesanan');
      kembaliDariPicking();
    });
  } else {
    enqueueOfflineAction(payload, 'updateProgressPesanan');
    kembaliDariPicking();
  }
}

function konfirmasiAmbilAlih(orderId) {
  const order = AppState.globalOrders.find(o => o.idPesanan === orderId);
  if (!order) return;

  AppState.pendingAmbilAlihOrderId = orderId;
  let totalTarget = 0, totalSiap = 0;
  (order.items || []).forEach(it => {
    totalTarget += Number(it.jumlah) || 0;
    totalSiap += Number(it.disiapkan) || 0;
  });

  const idEl = document.getElementById('ambilAlihModalOrderId');
  const prevEl = document.getElementById('ambilAlihModalPrevPicker');
  const txtEl = document.getElementById('ambilAlihModalProgressText');

  if (idEl) idEl.innerText = `#${order.idPesanan}`;
  if (prevEl) prevEl.innerText = order.picker || '-';
  if (txtEl) txtEl.innerText = `${totalSiap} / ${totalTarget} Pcs`;

  openModal('modalAmbilAlihTugas');
}

async function eksekusiAmbilAlih() {
  closeModal('modalAmbilAlihTugas');
  if (!AppState.pendingAmbilAlihOrderId) return;

  const order = AppState.globalOrders.find(o => o.idPesanan === AppState.pendingAmbilAlihOrderId);
  if (!order) return;

  order.picker = AppState.namaPicker;
  order.status = 'Diproses';

  idbSet('cached_orders', AppState.globalOrders);
  renderOrders();

  const payload = { sheetName: order.sheetName, idPesanan: order.idPesanan, newPickerName: AppState.namaPicker };
  if (navigator.onLine) {
    fetchAPI('gantiPickerPesanan', payload).catch(() => enqueueOfflineAction(payload, 'gantiPickerPesanan'));
  } else {
    enqueueOfflineAction(payload, 'gantiPickerPesanan');
  }

  showToast("Ambil Alih", `Melanjutkan tugas #${order.idPesanan}`);
  bukaPickingRoom(order.idPesanan);
}

function konfirmasiBatalTugas(orderId) {
  const order = AppState.globalOrders.find(o => o.idPesanan === orderId);
  if (!order) return;

  AppState.pendingBatalOrderId = orderId;
  const idEl = document.getElementById('batalModalOrderId');
  const storeEl = document.getElementById('batalModalStoreName');
  if (idEl) idEl.innerText = `#${order.idPesanan}`;
  if (storeEl) storeEl.innerText = order.namaToko;

  openModal('modalBatalTugas');
}

async function eksekusiBatalTugas() {
  closeModal('modalBatalTugas');
  if (!AppState.pendingBatalOrderId) return;

  const order = AppState.globalOrders.find(o => o.idPesanan === AppState.pendingBatalOrderId);
  if (!order) return;

  order.status = 'Pending';
  order.picker = '';
  (order.items || []).forEach(it => { it.disiapkan = 0; });

  idbSet('cached_orders', AppState.globalOrders);
  renderOrders();

  const payload = { sheetName: order.sheetName, idPesanan: order.idPesanan };
  if (navigator.onLine) {
    fetchAPI('batalkanAmbilTugas', payload).catch(() => enqueueOfflineAction(payload, 'batalkanAmbilTugas'));
  } else {
    enqueueOfflineAction(payload, 'batalkanAmbilTugas');
  }

  showToast("Tugas Direset", `#${order.idPesanan} kembali ke status Pending.`);
  if (AppState.activePickingOrder && AppState.activePickingOrder.idPesanan === order.idPesanan) {
    kembaliDariPicking();
  }
}

function openScanner(target = 'order') {
  AppState.currentScanTarget = target;
  openModal('modalScanner');

  setTimeout(() => {
    const readerEl = document.getElementById('reader');
    if (readerEl) readerEl.innerHTML = '';
    const flashBtn = document.getElementById('btnToggleFlash');
    if (flashBtn) flashBtn.classList.add('hidden');
    AppState.isFlashOn = false;

    try {
      if (!AppState.html5QrcodeScanner) {
        AppState.html5QrcodeScanner = new Html5Qrcode("reader");
      }
      AppState.html5QrcodeScanner.start(
        { facingMode: "environment" },
        { fps: 15, qrbox: { width: 220, height: 220 } },
        onScanSuccess,
        () => {}
      ).then(() => {
        const video = document.querySelector('#reader video');
        if (video && video.srcObject) {
          const track = video.srcObject.getVideoTracks()[0];
          if (track && typeof track.getCapabilities === 'function' && track.getCapabilities().torch) {
            if (flashBtn) flashBtn.classList.remove('hidden');
          }
        }
      }).catch(err => {
        showToast("Kamera Gagal", "Izin akses kamera diperlukan.", true);
        closeScanner();
      });
    } catch (e) {
      closeScanner();
    }
  }, 250);
}

function closeScanner() {
  if (AppState.html5QrcodeScanner && AppState.html5QrcodeScanner.isScanning) {
    AppState.html5QrcodeScanner.stop().then(() => closeModal('modalScanner')).catch(() => closeModal('modalScanner'));
  } else {
    closeModal('modalScanner');
  }
}

async function toggleFlash() {
  if (AppState.html5QrcodeScanner && AppState.html5QrcodeScanner.isScanning) {
    try {
      AppState.isFlashOn = !AppState.isFlashOn;
      await AppState.html5QrcodeScanner.applyVideoConstraints({ advanced: [{ torch: AppState.isFlashOn }] });
      const txt = document.getElementById('textFlash');
      if (txt) txt.innerText = AppState.isFlashOn ? 'Matikan Senter' : 'Senter';
    } catch (e) {
      AppState.isFlashOn = !AppState.isFlashOn;
    }
  }
}

function onScanSuccess(decodedText) {
  const sound = document.getElementById('notifSound');
  if (sound) sound.play().catch(() => {});
  closeScanner();

  const code = (decodedText || '').trim();
  if (AppState.currentScanTarget === 'order') {
    const inp = document.getElementById('searchOrder');
    if (inp) { inp.value = code; renderOrders(); }
  } else if (AppState.currentScanTarget === 'stok') {
    const inp = document.getElementById('searchStok');
    if (inp) { inp.value = code; filterStok(); }
  } else if (AppState.currentScanTarget === 'picking' && AppState.activePickingOrder) {
    const clean = code.toLowerCase();
    const foundIdx = (AppState.activePickingOrder.items || []).findIndex(it => (it.idBarang || '').toLowerCase().trim() === clean);

    if (foundIdx !== -1) {
      adjustPickingItemQty(foundIdx, 1);
      showToast("Scan Sukses", `+1 ${AppState.activePickingOrder.items[foundIdx].namaBarang}`);
    } else {
      showToast("SKU Tidak Ada", `Barcode ${code} bukan bagian dari pesanan ini.`, true);
    }
  }
}

function openStatusModal(sheetName, orderId) {
  AppState.currentStatusOrderId = orderId;
  AppState.currentStatusSheet = sheetName;
  const idEl = document.getElementById('statusModalOrderId');
  if (idEl) idEl.innerText = `#${orderId}`;
  openModal('modalStatus');
}

async function executeStatusUpdate(newStatus) {
  if (newStatus === 'Dikirim') {
    closeModal('modalStatus');
    const inp = document.getElementById('inputKodeUnik');
    if (inp) inp.value = '';
    openModal('modalKodeUnik');
    return;
  }

  closeModal('modalStatus');
  const order = AppState.globalOrders.find(o => o.idPesanan === AppState.currentStatusOrderId);
  if (order) order.status = newStatus;

  renderOrders();
  idbSet('cached_orders', AppState.globalOrders);

  const payload = {
    sheetName: AppState.currentStatusSheet || order?.sheetName,
    idPesanan: AppState.currentStatusOrderId,
    newStatus: newStatus,
    kodeUnik: ''
  };

  if (navigator.onLine) {
    setSyncIndicator(true);
    fetchAPI('updateStatusPesanan', payload).then(() => {
      setSyncIndicator(false);
      showToast("Status Diperbarui", `#${AppState.currentStatusOrderId} -> ${newStatus}`);
    }).catch(() => {
      setSyncIndicator(false);
      enqueueOfflineAction(payload, 'updateStatusPesanan');
    });
  } else {
    enqueueOfflineAction(payload, 'updateStatusPesanan');
  }
}

async function confirmDikirimStatus() {
  const inp = document.getElementById('inputKodeUnik');
  const kode = (inp?.value || '').trim();

  closeModal('modalKodeUnik');
  const order = AppState.globalOrders.find(o => o.idPesanan === AppState.currentStatusOrderId);
  if (order) order.status = 'Dikirim';

  renderOrders();
  idbSet('cached_orders', AppState.globalOrders);

  const payload = {
    sheetName: AppState.currentStatusSheet || order?.sheetName,
    idPesanan: AppState.currentStatusOrderId,
    newStatus: 'Dikirim',
    kodeUnik: kode
  };

  if (navigator.onLine) {
    setSyncIndicator(true);
    fetchAPI('updateStatusPesanan', payload).then(() => {
      setSyncIndicator(false);
      showToast("Pesanan Dikirim", `#${AppState.currentStatusOrderId}`);
    }).catch(() => {
      setSyncIndicator(false);
      enqueueOfflineAction(payload, 'updateStatusPesanan');
    });
  } else {
    enqueueOfflineAction(payload, 'updateStatusPesanan');
  }
}

function openPrintModal(orderId) {
  AppState.currentPrintOrderId = orderId;
  openModal('modalPrintSlot');
}

function executePrint(slotNumber) {
  closeModal('modalPrintSlot');
  const order = AppState.globalOrders.find(o => o.idPesanan === AppState.currentPrintOrderId);
  if (!order) return;

  const rowStart = Math.ceil(slotNumber / 2);
  const colStart = (slotNumber % 2 === 0) ? 2 : 1;
  const gridAreaCode = `${rowStart} / ${colStart} / ${rowStart + 1} / ${colStart + 1}`;

  const itemRows = (order.items || []).map((it, i) => `
    <tr>
      <td style="text-align:center; font-weight:bold; padding:3px 4px; border-bottom:1px dashed #ccc;">${i + 1}</td>
      <td style="font-weight:bold; padding:3px 4px; border-bottom:1px dashed #ccc; font-family:monospace;">${escapeHTML(it.idBarang)}</td>
      <td style="padding:3px 4px; border-bottom:1px dashed #ccc; text-transform:uppercase;">${escapeHTML(it.namaBarang)}</td>
      <td style="text-align:center; font-weight:bold; padding:3px 4px; border-bottom:1px dashed #ccc;">${it.jumlah || 0}</td>
    </tr>
  `).join('');

  const printHTML = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Label Pengiriman #${order.idPesanan}</title>
        <style>
          @page { size: A4 portrait; margin: 0; }
          body { margin: 0; padding: 0; font-family: -apple-system, sans-serif; background: #fff; }
          .a4-page { width: 210mm; height: 297mm; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; padding: 8mm; gap: 4mm; box-sizing: border-box; }
          .card-container { grid-area: ${gridAreaCode}; border: 1.5px dashed #000; border-radius: 6px; padding: 5mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; font-size: 9.5px; }
          .header { text-align: center; border-bottom: 1px solid #000; padding-bottom: 4px; margin-bottom: 4px; }
          .table-items { width: 100%; border-collapse: collapse; font-size: 9px; margin-top: 4px; }
          .signature { width: 100%; text-align: center; font-size: 8px; margin-top: 6px; }
          .sign-line { border-bottom: 1px dashed #000; height: 16px; width: 80%; margin: 2px auto 0; display: block; }
        </style>
      </head>
      <body>
        <div class="a4-page">
          <div class="card-container">
            <div class="header">
              <h3 style="margin:0; font-size:12px;">PAKET GUDANG: #${order.idPesanan}</h3>
              <h4 style="margin:2px 0 0; font-size:10.5px;">Penerima: ${order.namaToko}</h4>
            </div>
            <div>
              <div><strong>Waktu:</strong> ${order.tanggal}</div>
              ${order.catatan ? `<div><strong>Catatan:</strong> ${order.catatan}</div>` : ''}
              <table class="table-items">
                <thead>
                  <tr style="border-bottom:1px solid #000;">
                    <th style="width:20px;">No</th>
                    <th>SKU</th>
                    <th>Nama Barang</th>
                    <th style="width:30px; text-align:center;">Qty</th>
                  </tr>
                </thead>
                <tbody>${itemRows}</tbody>
              </table>
            </div>
            <table class="signature">
              <tr>
                <td style="width:50%;">Picker: ${order.picker || '-'}<span class="sign-line"></span></td>
                <td style="width:50%;">Kurir Ekspedisi<span class="sign-line"></span></td>
              </tr>
            </table>
          </div>
        </div>
        <script>
          setTimeout(() => { window.print(); window.close(); }, 300);
        <\/script>
      </body>
    </html>
  `;

  const printWin = window.open('', '_blank');
  if (!printWin) {
    showToast("Pop-up Diblokir", "Izinkan pop-up di browser untuk mencetak.", true);
    return;
  }
  printWin.document.open();
  printWin.document.write(printHTML);
  printWin.document.close();
}

function bukaModalBatchPrint() {
  if (AppState.selectedOrderIds.size === 0) {
    showToast("Pilih Pesanan", "Pilih minimal 1 pesanan untuk dicetak.");
    return;
  }

  const selectedOrders = (AppState.globalOrders || []).filter(o => AppState.selectedOrderIds.has(o.idPesanan));
  const ordersWithHeight = selectedOrders.map(o => {
    const itemCount = (o.items || []).length;
    const hasNote = Boolean(o.catatan);
    const estHeight = 36 + (itemCount * 6.5) + (hasNote ? 12 : 0);
    return { order: o, estHeight };
  });

  const MAX_COL_HEIGHT = 270;
  const pages = [];
  let curPage = { col1: [], col2: [], h1: 0, h2: 0 };

  ordersWithHeight.forEach(item => {
    if (curPage.h1 + item.estHeight <= MAX_COL_HEIGHT) {
      curPage.col1.push(item);
      curPage.h1 += item.estHeight;
    } else if (curPage.h2 + item.estHeight <= MAX_COL_HEIGHT) {
      curPage.col2.push(item);
      curPage.h2 += item.estHeight;
    } else {
      pages.push(curPage);
      curPage = { col1: [item], col2: [], h1: item.estHeight, h2: 0 };
    }
  });
  if (curPage.col1.length > 0 || curPage.col2.length > 0) {
    pages.push(curPage);
  }

  AppState.pendingBatchPages = pages;

  const summaryEl = document.getElementById('batchPrintAllocSummary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="flex items-center justify-between font-bold text-ios-text border-b border-ios-separator/30 pb-2">
        <span>Total ${selectedOrders.length} Pesanan</span>
        <span class="text-ios-blue font-mono text-sm">${pages.length} Lembar A4</span>
      </div>
      <div class="flex flex-col gap-1.5 mt-2">
        ${pages.map((p, pIdx) => `
          <div class="flex items-center justify-between p-2 rounded-xl bg-ios-card text-xs border border-ios-separator/40">
            <span class="font-bold text-ios-text">Lembar ${pIdx + 1}</span>
            <span class="text-ios-text-ter font-mono">${p.col1.length + p.col2.length} Order (Kiri: ${p.col1.length}, Kanan: ${p.col2.length})</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  openModal('modalBatchPrintPreview');
}

function eksekusiCetakBatchPintar() {
  closeModal('modalBatchPrintPreview');
  if (!AppState.pendingBatchPages || AppState.pendingBatchPages.length === 0) return;

  const pagesHTML = AppState.pendingBatchPages.map((page, pIdx) => {
    const renderCol = (items) => items.map(item => {
      const o = item.order;
      const rows = (o.items || []).map((it, i) => `
        <tr>
          <td style="text-align:center; font-weight:bold; padding:2px 3px; border-bottom:1px dashed #ddd;">${i + 1}</td>
          <td style="font-weight:bold; padding:2px 3px; border-bottom:1px dashed #ddd; font-family:monospace;">${escapeHTML(it.idBarang)}</td>
          <td style="padding:2px 3px; border-bottom:1px dashed #ddd; text-transform:uppercase;">${escapeHTML(it.namaBarang)}</td>
          <td style="text-align:center; font-weight:bold; padding:2px 3px; border-bottom:1px dashed #ddd;">${it.jumlah || 0}</td>
        </tr>
      `).join('');

      return `
        <div class="batch-card" style="border:1.5px solid #000; border-radius:5px; padding:3.5mm; margin-bottom:3.5mm; font-size:8.5px; break-inside:avoid;">
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid #000; padding-bottom:2px; margin-bottom:2px;">
            <strong style="font-size:10px;">#${o.idPesanan}</strong>
            <span style="font-weight:bold;">${o.namaToko}</span>
          </div>
          <div style="font-size:8px; margin-bottom:2px;">Waktu: ${o.tanggal} ${o.picker ? `| Picker: <strong>${o.picker}</strong>` : ''}</div>
          ${o.catatan ? `<div style="font-size:7.5px; background:#f4f4f4; padding:2px 3px; border-radius:3px; margin-bottom:2px;">Catatan: ${o.catatan}</div>` : ''}
          <table style="width:100%; border-collapse:collapse; font-size:8px;">
            <thead>
              <tr style="border-bottom:1px solid #000;">
                <th style="width:14px;">No</th>
                <th>SKU</th>
                <th>Barang</th>
                <th style="width:20px; text-align:center;">Qty</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }).join('');

    return `
      <div class="a4-batch-page">
        <div class="batch-page-header">
          <span>DUTA ABADI - Manifest Batch</span>
          <span>Halaman ${pIdx + 1} dari ${AppState.pendingBatchPages.length}</span>
        </div>
        <div class="batch-columns-container">
          <div class="batch-col">${renderCol(page.col1)}</div>
          <div class="batch-col">${renderCol(page.col2)}</div>
        </div>
      </div>
    `;
  }).join('');

  const fullHTML = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Cetak Batch Pesanan</title>
        <style>
          @page { size: A4 portrait; margin: 8mm; }
          body { margin: 0; padding: 0; font-family: -apple-system, sans-serif; background: #fff; }
          .a4-batch-page { width: 100%; min-height: 275mm; page-break-after: always; display: flex; flex-direction: column; }
          .a4-batch-page:last-child { page-break-after: auto; }
          .batch-page-header { display: flex; justify-content: space-between; font-size: 8px; font-weight: bold; border-bottom: 1px solid #999; padding-bottom: 2mm; margin-bottom: 3mm; color: #555; }
          .batch-columns-container { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; flex-grow: 1; }
          .batch-col { display: flex; flex-direction: column; }
        </style>
      </head>
      <body>
        ${pagesHTML}
        <script>
          setTimeout(() => { window.print(); window.close(); }, 350);
        <\/script>
      </body>
    </html>
  `;

  const pWin = window.open('', '_blank');
  if (!pWin) {
    showToast("Pop-up Diblokir", "Izinkan jendela pop-up di browser untuk mencetak.", true);
    return;
  }
  pWin.document.open();
  pWin.document.write(fullHTML);
  pWin.document.close();
}

function updateBluetoothButtonUI() {
  const btn = document.getElementById('btnConnectBluetooth');
  const icon = document.getElementById('btStatusIcon');
  const txt = document.getElementById('btStatusText');
  const dot = document.getElementById('btStatusDot');
  
  const isConnected = Boolean(AppState.btCharacteristic && AppState.btDevice && AppState.btDevice.gatt && AppState.btDevice.gatt.connected);

  if (isConnected) {
    if (btn) btn.className = 'h-8 px-2.5 rounded-full bg-ios-green/15 text-ios-green flex items-center gap-1.5 ios-press border border-ios-green/30';
    if (icon) { icon.innerText = 'bluetooth_connected'; icon.className = 'material-symbols-outlined text-[16px] text-ios-green'; }
    if (txt) { txt.innerText = AppState.btDevice?.name || 'Minipos Aktif'; txt.className = 'text-[10.5px] font-bold hidden sm:inline text-ios-green'; }
    if (dot) dot.className = 'w-1.5 h-1.5 rounded-full bg-ios-green animate-pulse';
  } else {
    if (btn) btn.className = 'h-8 px-2.5 rounded-full bg-ios-card-sub text-ios-text flex items-center gap-1.5 ios-press border border-ios-separator/60';
    if (icon) { icon.innerText = 'bluetooth'; icon.className = 'material-symbols-outlined text-[16px] text-ios-text-ter'; }
    if (txt) { txt.innerText = 'Hubungkan Minipos'; txt.className = 'text-[10.5px] font-bold hidden sm:inline text-ios-text-sec'; }
    if (dot) dot.className = 'w-1.5 h-1.5 rounded-full bg-ios-separator';
  }
}

async function toggleBluetoothPrinter() {
  if (AppState.btDevice && AppState.btDevice.gatt && AppState.btDevice.gatt.connected) {
    try {
      AppState.btDevice.gatt.disconnect();
    } catch (e) {}
    AppState.btDevice = null;
    AppState.btServer = null;
    AppState.btCharacteristic = null;
    updateBluetoothButtonUI();
    showToast("Bluetooth Terputus", "Koneksi ke printer Minipos telah diputus.");
    return;
  }

  await connectBluetoothPrinter(false);
}

async function connectBluetoothPrinter(silent = false) {
  if (!navigator.bluetooth) {
    if (!silent) showToast("Bluetooth Tidak Didukung", "Browser ini belum mendukung Web Bluetooth API. Gunakan Chrome di Android/PC.", true);
    return null;
  }

  try {
    if (!silent) showToast("Mencari Printer", "Pilih Minipos MP-80UBX pada daftar pop-up...");
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb',
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
        '0000ff00-0000-1000-8000-00805f9b34fb',
        '49535343-fe7d-4ae5-8fa9-9fafd205e455',
        '00001101-0000-1000-8000-00805f9b34fb'
      ]
    });

    device.addEventListener('gattserverdisconnected', () => {
      AppState.btCharacteristic = null;
      updateBluetoothButtonUI();
      showToast("Bluetooth Terputus", "Koneksi printer Minipos terputus.");
    });

    const server = await device.gatt.connect();
    let targetCharacteristic = null;
    const services = await server.getPrimaryServices();

    for (const service of services) {
      try {
        const chars = await service.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            targetCharacteristic = c;
            break;
          }
        }
        if (targetCharacteristic) break;
      } catch (e) {}
    }

    if (!targetCharacteristic) {
      throw new Error("Karakteristik write Bluetooth printer tidak ditemukan.");
    }

    AppState.btDevice = device;
    AppState.btServer = server;
    AppState.btCharacteristic = targetCharacteristic;
    updateBluetoothButtonUI();

    if (!silent) showToast("Minipos Terhubung", `${device.name || 'Printer'} siap digunakan untuk Auto-Print!`);
    return targetCharacteristic;
  } catch (err) {
    console.warn("Bluetooth connection cancelled/failed:", err);
    if (!silent) showToast("Bluetooth Batal", "Koneksi dibatalkan atau gagal.", true);
    updateBluetoothButtonUI();
    return null;
  }
}

function updateThermalModalWidthButtons() {
  const w58 = document.getElementById('btnWidth58');
  const w80 = document.getElementById('btnWidth80');
  const is80 = AppState.thermalPaperWidth === '80mm';
  if (w80) {
    w80.className = is80 
      ? 'px-2.5 py-0.5 rounded-lg bg-ios-blue text-white border-ios-blue font-bold text-xs' 
      : 'px-2.5 py-0.5 rounded-lg bg-ios-card-sub text-ios-text-ter border-ios-separator/60 text-xs';
  }
  if (w58) {
    w58.className = !is80 
      ? 'px-2.5 py-0.5 rounded-lg bg-ios-blue text-white border-ios-blue font-bold text-xs' 
      : 'px-2.5 py-0.5 rounded-lg bg-ios-card-sub text-ios-text-ter border-ios-separator/60 text-xs';
  }
}

function setThermalWidthDirect(width) {
  AppState.thermalPaperWidth = width;
  safeStorageSet('warehouse_thermal_width', width);
  const sel = document.getElementById('selectThermalWidth');
  if (sel) sel.value = width;
  updateThermalModalWidthButtons();
  showToast("Lebar Kertas", `Kertas thermal diatur ke ${width}`);
}

function openThermalChoiceModal(orderId, isBatch = false) {
  AppState.activeThermalOrderId = orderId;
  AppState.isBatchThermal = isBatch;
  const idEl = document.getElementById('thermalModalOrderId');
  if (idEl) {
    idEl.innerText = isBatch ? `Batch (${AppState.selectedOrderIds.size} Order)` : `#${orderId}`;
  }
  updateThermalModalWidthButtons();
  openModal('modalThermalChoice');
}

function cetakThermal(orderId) {
  if (AppState.btCharacteristic && AppState.btDevice?.gatt?.connected) {
    const o = AppState.globalOrders.find(it => it.idPesanan === orderId);
    if (o) {
      printThermalBluetooth([o]);
      return;
    }
  }
  openThermalChoiceModal(orderId, false);
}

function cetakBatchThermal() {
  if (AppState.selectedOrderIds.size === 0) {
    showToast("Pilih Pesanan", "Pilih minimal 1 pesanan untuk dicetak thermal.");
    return;
  }
  if (AppState.btCharacteristic && AppState.btDevice?.gatt?.connected) {
    const targetOrders = (AppState.globalOrders || []).filter(o => AppState.selectedOrderIds.has(o.idPesanan));
    if (targetOrders.length > 0) {
      printThermalBluetooth(targetOrders);
      return;
    }
  }
  openThermalChoiceModal(null, true);
}

function runThermalPrintWithMode(mode) {
  closeModal('modalThermalChoice');
  const isBatch = AppState.isBatchThermal;
  const orderId = AppState.activeThermalOrderId;

  let targetOrders = [];
  if (isBatch) {
    targetOrders = (AppState.globalOrders || []).filter(o => AppState.selectedOrderIds.has(o.idPesanan));
  } else {
    const o = AppState.globalOrders.find(it => it.idPesanan === orderId);
    if (o) targetOrders = [o];
  }

  if (targetOrders.length === 0) {
    showToast("Data Kosong", "Tidak ada data pesanan yang dipilih.", true);
    return;
  }

  if (mode === 'bluetooth') {
    printThermalBluetooth(targetOrders);
  } else if (mode === 'browser') {
    printThermalBrowser(targetOrders, AppState.thermalPaperWidth || '80mm');
  } else if (mode === 'rawbt') {
    printThermalRawBT(targetOrders);
  } else if (mode === 'qz') {
    printThermalQZTray(targetOrders);
  }
}

async function printThermalBluetooth(orders, isAuto = false) {
  let char = AppState.btCharacteristic;

  if (!char || !AppState.btDevice || !AppState.btDevice.gatt || !AppState.btDevice.gatt.connected) {
    connectBluetoothPrinter(isAuto).then(c => {
      if (c) printThermalBluetooth(orders, isAuto);
    });
    return;
  }

  try {
    if (!isAuto) showToast("Mencetak...", `Mengirim ${orders.length} struk ke Minipos (80mm)...`);

    const escpos = generateEscPosCommands(orders, AppState.thermalPaperWidth || '80mm');
    const encoder = new TextEncoder();
    const data = encoder.encode(escpos);

    const CHUNK_SIZE = 100;
    (async () => {
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, i + CHUNK_SIZE);
        if (char.properties.writeWithoutResponse) {
          await char.writeValueWithoutResponse(chunk);
        } else {
          await char.writeValue(chunk);
        }
      }

      const printedIds = orders.map(o => o.idPesanan);
      setOrderPrintStatus(printedIds, 'Sudah di Print');
      orders.forEach(o => AppState.inFlightPrintIds.delete(String(o.idPesanan).trim()));

      showToast("Print Sukses", `${orders.length} struk 80mm dicetak & dipotong otomatis.`);
    })().catch(err => {
      console.error("Bluetooth write error:", err);
      orders.forEach(o => AppState.inFlightPrintIds.delete(String(o.idPesanan).trim()));
      showToast("Bluetooth Putus", "Gagal mengirim data cetak ke Minipos.", true);
      updateBluetoothButtonUI();
    });
  } catch (err) {
    console.error("Bluetooth print error:", err);
    orders.forEach(o => AppState.inFlightPrintIds.delete(String(o.idPesanan).trim()));
    showToast("Bluetooth Putus", "Koneksi terputus saat mencetak.", true);
    updateBluetoothButtonUI();
  }
}

function printThermalBrowser(orders, paperWidth = null) {
  const selectedWidth = paperWidth || AppState.thermalPaperWidth || '80mm';
  const is80 = selectedWidth === '80mm';
  const widthVal = is80 ? '76mm' : '48mm';
  const printTime = new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }).replace(/\./g, ':');

  const printedIds = orders.map(o => o.idPesanan);
  setOrderPrintStatus(printedIds, 'Sudah di Print');

  const receiptsHTML = orders.map((order, idx) => {
    let totalQty = 0;
    const itemsHTML = (order.items || []).map(it => {
      const qty = Number(it.jumlah) || 0;
      totalQty += qty;
      return `
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px; border-bottom: 1px dashed #eee; padding-bottom: 4px;">
          <div style="flex: 1; padding-right: 8px;">
            <div style="font-weight: bold; font-size: ${is80 ? '11.5px' : '10px'}; font-family: monospace;">${escapeHTML(it.idBarang)}</div>
            <div style="font-size: ${is80 ? '11px' : '9.5px'}; color: #222;">${escapeHTML(it.namaBarang)}</div>
          </div>
          <div style="text-align: right; white-space: nowrap;">
            <span style="font-weight: bold; font-family: monospace; font-size: ${is80 ? '12px' : '10px'};">${qty} Pcs</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="receipt-box" style="${idx > 0 ? 'page-break-before: always; margin-top: 15px;' : ''}">
        <div style="text-align: center; margin-bottom: 8px;">
          <div style="font-weight: 800; font-size: ${is80 ? '15px' : '13px'}; letter-spacing: 0.5px;">DUTA ABADI</div>
          <div style="font-size: ${is80 ? '11.5px' : '10px'}; font-weight: bold; text-transform: uppercase;">MANIFEST PENGIRIMAN</div>
        </div>
        <div style="border-top: 1.5px dashed #000; border-bottom: 1.5px dashed #000; padding: 5px 0; margin-bottom: 8px; font-size: ${is80 ? '11.5px' : '10px'}; line-height: 1.4;">
          <div style="display: flex; justify-content: space-between;">
            <span>ID ORDER:</span>
            <strong style="font-family: monospace; font-size: ${is80 ? '12.5px' : '11px'};">#${order.idPesanan}</strong>
          </div>
          <div>TOKO : <strong>${escapeHTML(order.namaToko)}</strong></div>
          <div>WAKTU: ${order.tanggal || '-'}</div>
          <div>PICKER: <strong>${escapeHTML(order.picker || '-')}</strong></div>
          <div>CETAK: ${printTime}</div>
        </div>

        <div style="margin-bottom: 8px;">
          ${itemsHTML}
        </div>

        <div style="border-top: 1.5px dashed #000; padding-top: 5px; font-size: ${is80 ? '12px' : '11px'}; font-weight: bold; display: flex; justify-content: space-between;">
          <span>TOTAL BARANG:</span>
          <span style="font-family: monospace;">${totalQty} Pcs</span>
        </div>

        ${order.catatan ? `
          <div style="margin-top: 8px; padding: 4px; border: 1px dashed #555; font-size: 10px; word-break: break-word;">
            <strong>CATATAN:</strong> ${escapeHTML(order.catatan)}
          </div>
        ` : ''}

        <div style="text-align: center; font-size: 9px; margin-top: 10px; color: #333;">
          <div>- Simpan tanda bukti ini untuk manifest pengiriman -</div>
          <div style="letter-spacing: 2px; margin-top: 2px; font-weight: bold;">*** SELESAI ***</div>
        </div>
      </div>
    `;
  }).join('');

  const fullHTML = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Cetak Struk Thermal ${selectedWidth}</title>
        <style>
          @page { size: ${selectedWidth} auto; margin: 0; }
          @media print {
            html, body {
              width: ${selectedWidth};
              margin: 0 !important;
              padding: 0 !important;
              background: #fff !important;
              color: #000 !important;
            }
            .receipt-box {
              width: 100% !important;
              box-sizing: border-box;
              padding: 4mm 3mm !important;
            }
          }
          body {
            margin: 0 auto;
            padding: 8px;
            width: ${widthVal};
            font-family: 'Courier New', Courier, monospace, sans-serif;
            background: #fff;
            color: #000;
            font-size: ${is80 ? '11.5px' : '10.5px'};
            line-height: 1.3;
          }
          .receipt-box { width: 100%; box-sizing: border-box; }
        </style>
      </head>
      <body>
        ${receiptsHTML}
        <script>
          window.onload = function() {
            setTimeout(() => {
              window.print();
              setTimeout(() => window.close(), 600);
            }, 250);
          };
        <\/script>
      </body>
    </html>
  `;

  const pWin = window.open('', '_blank', 'width=420,height=650');
  if (!pWin) {
    showToast("Pop-up Diblokir", "Izinkan pop-up browser untuk mencetak struk thermal.", true);
    return;
  }
  pWin.document.open();
  pWin.document.write(fullHTML);
  pWin.document.close();
}

function printThermalRawBT(orders) {
  showToast("RawBT", `Mengirim ${orders.length} struk ke RawBT...`);
  const escpos = generateEscPosCommands(orders);

  try {
    const base64Data = btoa(unescape(encodeURIComponent(escpos)));
    const intentUrl = "intent:" + base64Data + "#Intent;scheme=rawb64;package=ru.a402d.rawbtprinter;end;";
    window.location.assign(intentUrl);
  } catch (e) {
    showToast("Gagal RawBT", "Beralih ke mode Universal...", true);
    printThermalBrowser(orders, AppState.thermalPaperWidth);
  }
}

function printThermalQZTray(orders) {
  if (typeof qz === 'undefined') {
    showToast("QZ Tray Error", "Library QZ Tray tidak termuat. Gunakan Mode Universal.", true);
    printThermalBrowser(orders, AppState.thermalPaperWidth);
    return;
  }

  const escpos = generateEscPosCommands(orders);
  showToast("QZ Tray", "Menghubungkan ke aplikasi QZ Tray di PC...");

  qz.websocket.connect().then(() => {
    return qz.printers.find(AppState.thermalPrinterName || 'MINIPOS');
  }).then((printer) => {
    var config = qz.configs.create(printer);
    return qz.print(config, [escpos]);
  }).then(() => {
    showToast("Print Sukses", "Struk berhasil dicetak & dipotong.");
    return qz.websocket.disconnect();
  }).catch((err) => {
    console.warn("QZ Tray connect failed:", err);
    showToast("QZ Tray Tidak Aktif", "Beralih ke Mode Universal...", true);
    printThermalBrowser(orders, AppState.thermalPaperWidth);
    if (qz.websocket && qz.websocket.isActive()) qz.websocket.disconnect();
  });
}

function testPrintThermal() {
  const sampleOrder = {
    idPesanan: 'TEST-001',
    namaToko: 'TOKO CONTOH TEST PRINT',
    tanggal: new Date().toISOString().slice(0, 10),
    picker: AppState.namaPicker || 'Operator Gudang',
    catatan: 'Uji coba hasil cetak printer thermal Minipos MP-80UBX berhasil!',
    items: [
      { idBarang: 'SKU-SAMPLE-1', namaBarang: 'Barang Uji Coba A', jumlah: 2 },
      { idBarang: 'SKU-SAMPLE-2', namaBarang: 'Barang Uji Coba B', jumlah: 5 }
    ]
  };

  const mode = AppState.thermalMode || 'bluetooth';
  if (mode === 'bluetooth') {
    printThermalBluetooth([sampleOrder]);
  } else if (mode === 'browser') {
    printThermalBrowser([sampleOrder], AppState.thermalPaperWidth || '80mm');
  } else if (mode === 'rawbt') {
    printThermalRawBT([sampleOrder]);
  } else if (mode === 'qz') {
    printThermalQZTray([sampleOrder]);
  }
}

function onThermalSettingChange() {
  const selMode = document.getElementById('selectThermalMode')?.value;
  const selWidth = document.getElementById('selectThermalWidth')?.value;
  const qzContainer = document.getElementById('qzPrinterNameContainer');

  if (selMode) {
    AppState.thermalMode = selMode;
    safeStorageSet('warehouse_thermal_mode', selMode);
  }
  if (selWidth) {
    AppState.thermalPaperWidth = selWidth;
    safeStorageSet('warehouse_thermal_width', selWidth);
  }

  if (qzContainer) {
    qzContainer.style.display = selMode === 'qz' ? 'flex' : 'none';
  }
}

async function loadSetupConfig() {
  try {
    const res = await fetchAPI('getSetupData');
    if (res && res.success) {
      setupFormPengaturan(res.allSheets, res.savedStockSheet, res.savedOrderSheets);
    }
  } catch (e) {
    console.warn("Setup load error:", e);
  }
}

function setupFormPengaturan(allSheets, savedStockSheet, savedOrderSheets) {
  const selectStock = document.getElementById('selectStockSheet');
  const checkContainer = document.getElementById('checkboxOrderSheets');
  const inpPrinter = document.getElementById('inputPrinterName');
  const selMode = document.getElementById('selectThermalMode');
  const selWidth = document.getElementById('selectThermalWidth');

  if (selectStock) {
    selectStock.innerHTML = (allSheets || []).map(s => `
      <option value="${escapeHTML(s)}" ${s === savedStockSheet ? 'selected' : ''}>${escapeHTML(s)}</option>
    `).join('');
  }

  if (checkContainer) {
    checkContainer.innerHTML = (allSheets || []).map(s => `
      <label class="flex items-center justify-between p-2 rounded-xl bg-ios-card hover:bg-ios-separator/30 cursor-pointer border border-ios-separator/30">
        <div class="flex items-center gap-2.5">
          <input type="checkbox" value="${escapeHTML(s)}" ${(savedOrderSheets || []).includes(s) ? 'checked' : ''} class="order-sheet-chk w-4 h-4 accent-ios-blue cursor-pointer" />
          <span class="font-semibold text-ios-text text-xs">${escapeHTML(s)}</span>
        </div>
      </label>
    `).join('');
  }
  
  if (inpPrinter) inpPrinter.value = AppState.thermalPrinterName || '';
  if (selMode) selMode.value = AppState.thermalMode || 'bluetooth';
  if (selWidth) selWidth.value = AppState.thermalPaperWidth || '80mm';
  onThermalSettingChange();
}

function saveSheetConfig() {
  if (!isSuperAdmin() || !AppState.currentUser?._sessionPass) {
    const inpUser = document.getElementById('inputSuperAdminUser');
    if (inpUser && isSuperAdmin()) {
      inpUser.value = AppState.currentUser?.username || '';
    }
    openModal('modalAuthSuperAdmin');
    return;
  }
  eksekusiSimpanSheet(AppState.currentUser?.username, AppState.currentUser?._sessionPass);
}

async function eksekusiSimpanSheet(username, password) {
  const stockSheet = document.getElementById('selectStockSheet')?.value;
  const checkedSheets = Array.from(document.querySelectorAll('.order-sheet-chk:checked')).map(c => c.value);
  const printerName = document.getElementById('inputPrinterName')?.value.trim();

  if (!stockSheet || checkedSheets.length === 0) {
    showToast("Perhatian", "Pilih Sheet Stok dan minimal 1 sheet pesanan toko!", true);
    return;
  }
  
  if (printerName) {
    AppState.thermalPrinterName = printerName;
    safeStorageSet('warehouse_printer_name', printerName);
  }

  setSyncIndicator(true);
  try {
    const res = await fetchAPI('verifyAndSaveSettings', {
      username: username,
      password: password,
      stockSheet: stockSheet,
      orderSheetsArray: JSON.stringify(checkedSheets)
    });
    setSyncIndicator(false);
    if (res && res.success) {
      showToast("Sukses", "Konfigurasi sistem berhasil disimpan.");
      loadAdminData(true);
    } else {
      showToast("Gagal", (res && res.message) || "Otorisasi Super Admin gagal.", true);
    }
  } catch (e) {
    setSyncIndicator(false);
    showToast("Error", e.message, true);
  }
}

function verifyAndSaveSuperAdmin() {
  const u = document.getElementById('inputSuperAdminUser')?.value.trim();
  const p = document.getElementById('inputSuperAdminPass')?.value.trim();
  const err = document.getElementById('superAdminAuthError');

  if (!u || !p) {
    if (err) { err.innerText = "Masukkan username & password!"; err.classList.remove('hidden'); }
    return;
  }

  closeModal('modalAuthSuperAdmin');
  eksekusiSimpanSheet(u, p);
}

async function clearAppCache() {
  localStorage.removeItem('cached_stok');
  localStorage.removeItem('cached_orders');
  localStorage.removeItem('offline_action_queue');
  localStorage.removeItem('warehouse_seen_orders');
  localStorage.removeItem('warehouse_seen_lowstock');
  localStorage.removeItem('warehouse_notif_muted');

  try {
    const db = await openIndexedDB();
    const tx = db.transaction(IDB_CONFIG.storeName, 'readwrite');
    tx.objectStore(IDB_CONFIG.storeName).clear();
  } catch (e) {}

  AppState.globalOrders = [];
  AppState.globalStok = [];
  AppState.offlineActionQueue = [];
  AppState.lastSeenOrderIds = new Set();
  AppState.lastSeenLowStock = new Set();
  AppState.notifMuted = false;
  syncNotifToggleUI();
  renderOrders();
  filterStok(true);
  updateStokBadge();
  updateOutboxUI();
  showToast("Cache Bersih", "Memori lokal telah dikosongkan.");
}

function openModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) {
    m.classList.remove('hidden');
    const box = m.querySelector('.rounded-3xl, .rounded-2xl');
    if (box && typeof gsap !== 'undefined') {
      gsap.fromTo(box, { y: 22, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.2)' });
    }
  }
}

function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.add('hidden');
}

function showToast(title, msg, isError = false) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `p-3 rounded-2xl ${isError ? 'bg-ios-red text-white' : 'bg-ios-card text-ios-text border border-ios-separator/70'} shadow-xl flex items-center gap-2.5 pointer-events-auto w-full text-xs`;
  toast.innerHTML = `
    <span class="material-symbols-outlined text-[17px] ${isError ? 'text-white' : 'text-ios-blue'} shrink-0">${isError ? 'error' : 'check_circle'}</span>
    <div class="flex flex-col min-w-0">
      <span class="font-bold truncate leading-tight">${escapeHTML(title)}</span>
      <span class="text-[10.5px] opacity-80 truncate leading-tight mt-0.5">${escapeHTML(msg)}</span>
    </div>
  `;

  container.appendChild(toast);
  if (typeof gsap !== 'undefined') {
    gsap.fromTo(toast, { y: -12, opacity: 0, scale: 0.95 }, { y: 0, opacity: 1, scale: 1, duration: 0.28, ease: 'back.out(1.2)' });
    setTimeout(() => {
      gsap.to(toast, { opacity: 0, y: -8, duration: 0.22, onComplete: () => toast.remove() });
    }, 3000);
  } else {
    setTimeout(() => toast.remove(), 3200);
  }
}

window.WarehouseApp = {
  initTheme,
  toggleTheme,
  switchMainTab,
  handleInitialLogin,
  logoutPengguna,
  eksekusiLogout,
  setOrderFilter,
  handleOrderInput,
  handleStokInput,
  setStokStatusFilter,
  openStokDetailModal,
  openScanner,
  closeScanner,
  toggleFlash,
  filterStok,
  downloadStokCSV,
  ambilTugasPicker,
  bukaPickingRoom,
  kembaliDariPicking,
  adjustPickingItemQty,
  setPickingItemQtyDirect,
  simpanProgressPicking,
  eksekusiSelesaiDanKirim,
  konfirmasiAmbilAlih,
  eksekusiAmbilAlih,
  konfirmasiBatalTugas,
  eksekusiBatalTugas,
  getActivePickingOrderId: () => AppState.activePickingOrder ? AppState.activePickingOrder.idPesanan : '',
  openStatusModal,
  executeStatusUpdate,
  confirmDikirimStatus,
  toggleSelectAllOrders,
  toggleOrderSelection,
  clearOrderSelection,
  bukaModalBatchPrint,
  eksekusiCetakBatchPintar,
  cetakBatchThermal,
  openPrintModal,
  executePrint,
  cetakThermal,
  openThermalChoiceModal,
  runThermalPrintWithMode,
  setThermalWidthDirect,
  testPrintThermal,
  onThermalSettingChange,
  saveSheetConfig,
  verifyAndSaveSuperAdmin,
  clearAppCache,
  toggleNotifMute,
  toggleAutoPrintSwitch,
  simulasiOrderBaruAutoPrint,
  syncNotifToggleUI,
  updateStokBadge,
  processOfflineQueue,
  loadAdminData,
  openModal,
  closeModal,
  toggleBluetoothPrinter,
  connectBluetoothPrinter,
  setOrderPrintStatus,
  toggleOrderPrintStatusDirect
};

window.onload = async function() {
  initTheme();
  updateSessionUI();
  updateOutboxUI();
  loadNotificationSnapshot();
  syncNotifToggleUI();
  startLiveClock();
  updateBluetoothButtonUI();

  const idbO = await idbGet('cached_orders', null);
  const idbS = await idbGet('cached_stok', null);
  if (idbO) AppState.globalOrders = idbO;
  if (idbS) AppState.globalStok = idbS;

  if (AppState.globalOrders.length > 0) renderOrders();
  if (AppState.globalStok.length > 0) { filterStok(true); updateStokBadge(); }

  if (!AppState.currentUser) {
    openModal('modalLoginAwal');
  } else {
    loadAdminData(false, false);
  }

  // Polling interval every 20s for real-time background sync and auto-print
  setInterval(() => {
    if (navigator.onLine && AppState.currentUser && !AppState.activePickingOrder) {
      loadAdminData(false, true);
    }
  }, 20000);
};
