
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const archiver = require('archiver');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// ========== KONFIGURASI ==========
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://digitalpediah2h.orderhostid.my.id';
const WITHDRAWAL_FEE = 2000;
const MIN_WITHDRAW = 10000;
const MAX_WITHDRAW = 10000000;

if (!BOT_TOKEN || !ADMIN_ID) {
  console.error('BOT_TOKEN atau ADMIN_TELEGRAM_ID tidak diisi di .env');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ========== NOTIFIKASI ==========
async function sendToOwner(text, options = {}) {
  try {
    await bot.sendMessage(ADMIN_ID, text, options);
  } catch(e) { console.error('Gagal kirim ke owner:', e.message); }
}

// ========== DATABASE ==========
const dataPath = path.join(__dirname, 'data');
if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath);
const usersFile = path.join(dataPath, 'users.json');
const depositsFile = path.join(dataPath, 'deposits.json');
const withdrawalsFile = path.join(dataPath, 'withdrawals.json');
const chatsFile = path.join(dataPath, 'chats.json');
// Di bagian awal, tambahkan:
const adminLogsFile = path.join(dataPath, 'admin_logs.json');
function readDB(file) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file));
}
function writeDB(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function formatRupiah(angka) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(angka);
}

function generateTransactionId(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}
// ========== DOWNLOAD GAMBAR DARI URL DAN KONVERSI KE BASE64 ==========
async function convertImageUrlToBase64(imageUrl) {
    try {
        // Download gambar dari URL
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        // Konversi ke base64
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        const contentType = response.headers['content-type'] || 'image/png';
        
        return `data:${contentType};base64,${base64}`;
        
    } catch (error) {
        console.error('❌ Gagal konversi URL ke base64:', error.message);
        return null;
    }
}
// ========== AUTO BACKUP ==========
const backupDir = path.join(dataPath, 'backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);

cron.schedule('0 * * * *', () => {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const zipPath = path.join(backupDir, `backup-${timestamp}.zip`);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  output.on('close', async () => {
    const sizeKB = (archive.pointer() / 1024).toFixed(2);
    await sendToOwner(`✅ Backup berhasil: backup-${timestamp}.zip (${sizeKB} KB)`);
    await bot.sendDocument(ADMIN_ID, zipPath, { caption: '📦 Backup Data Digital Pedia H2H' });
  });
  
  archive.pipe(output);
  const filesToBackup = ['users.json', 'deposits.json', 'withdrawals.json', 'chats.json'];
  filesToBackup.forEach(file => {
    const filePath = path.join(dataPath, file);
    if (fs.existsSync(filePath)) archive.file(filePath, { name: file });
  });
  archive.finalize();
});
// ========== API ENDPOINTS ==========

// REGISTER
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  const usernameRegex = /^[a-z0-9]{3,20}$/;
  if (!username || !usernameRegex.test(username)) {
    return res.status(400).json({ success: false, error: 'Username harus 3-20 karakter, hanya huruf kecil a-z dan angka' });
  }
  if (!password || password.length < 4) {
    return res.status(400).json({ success: false, error: 'Password minimal 4 karakter' });
  }
  
  let users = readDB(usersFile);
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ success: false, error: 'Username sudah terdaftar' });
  }
  
  const apiKey = 'dp_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 8);
  
  const newUser = {
    id: Date.now(),
    username: username,
    password: password,
    apiKey: apiKey,
    balance: 0,
    created_at: Date.now()
  };
  users.push(newUser);
  writeDB(usersFile, users);
  
  await sendToOwner(`🆕 *USER BARU REGISTRASI*\n━━━━━━━━━━━━━━━━\n👤 Username: ${username}\n🆔 User ID: ${newUser.id}\n🔑 API Key: ${apiKey}`, { parse_mode: 'Markdown' });
  
  res.json({ success: true, message: 'Registrasi berhasil' });
});

// LOGIN
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password required' });
  }
  let users = readDB(usersFile);
  let user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  res.json({ success: true, user: { id: user.id, username: user.username, balance: user.balance, apiKey: user.apiKey } });
});

// GET USER
app.get('/api/user/:id', (req, res) => {
  const users = readDB(usersFile);
  const user = users.find(u => u.id == req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, username: user.username, balance: user.balance, apiKey: user.apiKey });
});

// CEK SALDO VIA API KEY (untuk integrasi)
app.post('/api/balance', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ success: false, error: 'API Key required' });
  
  const users = readDB(usersFile);
  const user = users.find(u => u.apiKey === apiKey);
  if (!user) return res.status(401).json({ success: false, error: 'Invalid API Key' });
  
  res.json({ success: true, balance: user.balance, username: user.username });
});
// ========== KONFIGURASI ==========
const DEPOSIT_CHECK_INTERVAL = 30000; // 30 detik
const DEPOSIT_MAX_RETRY = 5; // Maksimal cek 5x per deposit
const DEPOSIT_COOLDOWN_BETWEEN_CHECK = 60000; // 1 menit antar cek

// Simpan data deposit yang sedang diproses
const pendingDepositChecks = new Map();

// ========== DEPOSIT CREATE ==========
app.post('/api/deposit/create', async (req, res) => {
    const { amount } = req.body;
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return res.status(401).json({ success: false, error: 'API Key required' });
    }
    if (!amount || amount < 500) {
        return res.status(400).json({ success: false, error: 'Minimal deposit Rp500' });
    }
    if (amount > 1000000) {
        return res.status(400).json({ success: false, error: 'Maksimal deposit Rp1.000.000' });
    }
    
    const users = readDB(usersFile);
    const user = users.find(u => u.apiKey === apiKey);
    if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid API Key' });
    }
    
    const randomFee = Math.floor(Math.random() * 700) + 1;
    const totalBayar = amount + randomFee;
    // 🔥 ID DEPOSIT SENDIRI (bukan dari API)
    const kodeTrx = generateTransactionId('DP');
    const expireTime = Date.now() + (60 * 60 * 1000); // 1 jam expired
    
    try {
        const apiKeyOrkut = process.env.ORDERKUOTA_API_KEY;
        const usernameOrkut = process.env.ORDERKUOTA_USERNAME;
        const tokenOrkut = process.env.ORDERKUOTA_TOKEN;
        
        // Panggil API untuk generate QRIS
        const createUrl = `https://orderhostid.my.id/?action=createpayment&apikey=${apiKeyOrkut}&username=${usernameOrkut}&amount=${totalBayar}&token=${tokenOrkut}`;
        console.log(`📡 Create QRIS: ${createUrl}`);
        
        const response = await axios.get(createUrl, { timeout: 15000 });
        console.log('📥 Response:', JSON.stringify(response.data, null, 2));
        
        if (!response.data?.status) {
            throw new Error(response.data?.message || 'Gagal membuat QRIS');
        }
        
        const qrImageUrl = response.data.result?.qris_image;
        if (!qrImageUrl) {
            throw new Error('QRIS image tidak ditemukan');
        }
        
        // 🔥 SIMPAN DENGAN ID SENDIRI
        const newDeposit = {
            id: kodeTrx,  // ID deposit kita sendiri
            trxid_api: response.data.result?.trxid, // simpan ID dari API (untuk referensi)
            user_id: user.id,
            username: user.username,
            amount: amount,
            fee: randomFee,
            total_bayar: totalBayar,
            qr_image: qrImageUrl,
            status: 'pending',
            created_at: Date.now(),
            expired_at: expireTime
        };
        
        const deposits = readDB(depositsFile);
        deposits.push(newDeposit);
        writeDB(depositsFile, deposits);
        
        // Notifikasi ke owner
        const notifCaption = `💰 *DEPOSIT BARU*\n━━━━━━━━━━━━━━━━\n👤 User: ${user.username}\n💰 Jumlah: ${formatRupiah(amount)}\n💳 Fee: ${formatRupiah(randomFee)}\n💵 Total: ${formatRupiah(totalBayar)}\n🧾 ID: ${kodeTrx}\n⏰ Expired: 1 jam`;
        
        if (qrImageUrl) {
            try {
                await bot.sendPhoto(ADMIN_ID, qrImageUrl, { caption: notifCaption, parse_mode: 'Markdown' });
            } catch(e) {
                await sendToOwner(notifCaption, { parse_mode: 'Markdown' });
            }
        } else {
            await sendToOwner(notifCaption, { parse_mode: 'Markdown' });
        }
        
        res.json({
            success: true,
            deposit: {
                id: kodeTrx,
                amount: amount,
                fee: randomFee,
                total_payment: totalBayar,
                qr_image: qrImageUrl,
                status: 'pending',
                expired_at: expireTime
            }
        });
        
    } catch (error) {
        console.error('❌ Error create deposit:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== CEK STATUS DEPOSIT (Berdasarkan Nominal) ==========
const depositCheckCooldown = new Map();

function canCheckDeposit(depositId) {
    const lastCheck = depositCheckCooldown.get(depositId);
    if (!lastCheck) return true;
    return (Date.now() - lastCheck) >= 30000; // 30 detik cooldown
}

function setDepositChecked(depositId) {
    depositCheckCooldown.set(depositId, Date.now());
}

async function checkOrderkuotaMutation(targetAmount, startTime) {
    try {
        const apiKeyOrkut = process.env.ORDERKUOTA_API_KEY;
        const usernameOrkut = process.env.ORDERKUOTA_USERNAME;
        const tokenOrkut = process.env.ORDERKUOTA_TOKEN;
        
        const mutasiUrl = `https://orderhostid.my.id/?action=mutasiqr&apikey=${apiKeyOrkut}&username=${usernameOrkut}&token=${tokenOrkut}`;
        console.log(`📡 Cek mutasi: ${mutasiUrl}`);
        
        const response = await axios.get(mutasiUrl, { timeout: 15000 });
        
        if (!response.data?.status || !response.data?.result?.results) {
            console.log('⚠️ Tidak ada data mutasi');
            return { found: false };
        }
        
        // Cari transaksi dengan nominal yang sama
        const found = response.data.result.results.find(t => {
            if (t.status !== "IN") return false;
            // Bersihkan format nominal (hapus titik dan koma)
            const nominalStr = String(t.kredit || '0').replace(/\./g, '').replace(/,/g, '');
            const nominal = parseInt(nominalStr) || 0;
            
            // Cek apakah nominal sama dengan target
            if (nominal !== targetAmount) return false;
            
            // Cek waktu transaksi (opsional)
            if (t.tanggal && startTime) {
                try {
                    const [datePart, timePart] = t.tanggal.split(' ');
                    const [day, month, year] = datePart.split('/').map(Number);
                    const [hour, minute, second] = timePart.split(':').map(Number);
                    const transTime = new Date(year, month-1, day, hour, minute, second).getTime();
                    // Hanya ambil transaksi setelah deposit dibuat (maks 1 jam sebelumnya)
                    if (transTime < startTime - 3600000) return false;
                } catch(e) {
                    // Abaikan error parsing tanggal
                }
            }
            return true;
        });
        
        if (found) {
            console.log(`✅ Transaksi ditemukan: ${found.kredit}`);
            return { found: true, data: found };
        }
        
        console.log('❌ Transaksi belum ditemukan');
        return { found: false };
        
    } catch (err) {
        console.error('❌ Gagal cek mutasi:', err.message);
        return { found: false, error: err.message };
    }
}

app.post('/api/deposit/status', async (req, res) => {
    const { deposit_id } = req.body;
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return res.status(401).json({ success: false, error: 'API Key required' });
    }
    if (!deposit_id) {
        return res.status(400).json({ success: false, error: 'Deposit ID required' });
    }
    
    const users = readDB(usersFile);
    const user = users.find(u => u.apiKey === apiKey);
    if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid API Key' });
    }
    
    const deposits = readDB(depositsFile);
    const deposit = deposits.find(d => d.id === deposit_id);
    if (!deposit) {
        return res.status(404).json({ success: false, error: 'Deposit not found' });
    }
    
    if (deposit.user_id !== user.id) {
        return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    // Jika sudah sukses
    if (deposit.status === 'success') {
        return res.json({ success: true, status: 'success', message: 'Deposit sudah berhasil' });
    }
    
    // Jika sudah dibatalkan
    if (deposit.status === 'canceled') {
        return res.json({ success: true, status: 'canceled', message: 'Deposit sudah dibatalkan' });
    }
    
    // Jika expired
    if (Date.now() > deposit.expired_at && deposit.status === 'pending') {
        deposit.status = 'expired';
        writeDB(depositsFile, deposits);
        return res.json({ success: true, status: 'expired', message: 'Deposit expired' });
    }
    
    // 🔥 COOLDOWN CHECK (30 detik, tapi tetap fleksibel)
    if (!canCheckDeposit(deposit_id)) {
        const lastCheck = depositCheckCooldown.get(deposit_id);
        const remainingSeconds = Math.ceil((30000 - (Date.now() - lastCheck)) / 1000);
        return res.json({
            success: true,
            status: 'pending',
            message: `Menunggu pembayaran. Cek kembali setelah ${remainingSeconds} detik`,
            next_check_available_in: remainingSeconds
        });
    }
    
    // Tandai sedang dicek
    setDepositChecked(deposit_id);
    
    // 🔥 CEK MUTASI BERDASARKAN NOMINAL TOTAL BAYAR
    try {
        const result = await checkOrderkuotaMutation(deposit.total_bayar, deposit.created_at);
        
        if (result.found) {
            deposit.status = 'success';
            deposit.paid_at = Date.now();
            writeDB(depositsFile, deposits);
            
            // Tambah saldo user
            const userUpdate = users.find(u => u.id === deposit.user_id);
            if (userUpdate) {
                const saldoLama = userUpdate.balance;
                userUpdate.balance += deposit.amount;
                writeDB(usersFile, users);
                
                await sendToOwner(`✅ *DEPOSIT BERHASIL*\n━━━━━━━━━━━━━━━━\n👤 User: ${deposit.username}\n💰 Jumlah: ${formatRupiah(deposit.amount)}\n💳 Fee: ${formatRupiah(deposit.fee)}\n💵 Total: ${formatRupiah(deposit.total_bayar)}\n💵 Saldo Lama: ${formatRupiah(saldoLama)}\n💵 Saldo Baru: ${formatRupiah(userUpdate.balance)}\n🧾 ID: ${deposit.id}`, { parse_mode: 'Markdown' });
            }
            
            return res.json({ success: true, status: 'success', message: 'Deposit berhasil! Saldo bertambah.' });
        }
        
        return res.json({ success: true, status: 'pending', message: 'Menunggu pembayaran' });
        
    } catch (error) {
        console.error('❌ Error cek deposit:', error.message);
        return res.json({ success: true, status: 'pending', message: 'Menunggu pembayaran' });
    }
});

// ========== CANCEL DEPOSIT ==========
app.post('/api/deposit/cancel', async (req, res) => {
    const { deposit_id } = req.body;
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return res.status(401).json({ success: false, error: 'API Key required' });
    }
    if (!deposit_id) {
        return res.status(400).json({ success: false, error: 'Deposit ID required' });
    }
    
    const users = readDB(usersFile);
    const user = users.find(u => u.apiKey === apiKey);
    if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid API Key' });
    }
    
    const deposits = readDB(depositsFile);
    const deposit = deposits.find(d => d.id === deposit_id);
    if (!deposit) {
        return res.status(404).json({ success: false, error: 'Deposit not found' });
    }
    
    if (deposit.user_id !== user.id) {
        return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    if (deposit.status !== 'pending') {
        return res.status(400).json({ success: false, error: `Deposit status ${deposit.status}, tidak bisa dibatalkan` });
    }
    
    // Batalkan deposit
    deposit.status = 'canceled';
    deposit.canceled_at = Date.now();
    writeDB(depositsFile, deposits);
    
    await sendToOwner(`❌ *DEPOSIT DIBATALKAN*\n━━━━━━━━━━━━━━━━\n👤 User: ${deposit.username}\n💰 Jumlah: ${formatRupiah(deposit.amount)}\n💳 Fee: ${formatRupiah(deposit.fee)}\n🧾 ID: ${deposit.id}`, { parse_mode: 'Markdown' });
    
    res.json({ success: true, message: 'Deposit berhasil dibatalkan' });
});
// ========== DEPOSIT VIA WEB (QR LANGSUNG BASE64) ==========
app.post('/api/depo/create', async (req, res) => {
    const { user_id, username, nominal } = req.body;
    
    // Validasi input
    if (!user_id) {
        return res.status(400).json({ success: false, error: 'User ID required' });
    }
    if (!username) {
        return res.status(400).json({ success: false, error: 'Username required' });
    }
    if (!nominal || nominal < 500) {
        return res.status(400).json({ success: false, error: 'Minimal deposit Rp500' });
    }
    if (nominal > 1000000) {
        return res.status(400).json({ success: false, error: 'Maksimal deposit Rp1.000.000' });
    }
    
    // Cek user
    const users = readDB(usersFile);
    const user = users.find(u => u.id == user_id && u.username === username);
    if (!user) {
        return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    }
    
    const randomFee = Math.floor(Math.random() * 700) + 1;
    const totalBayar = nominal + randomFee;
    const kodeTrx = generateTransactionId('DP');
    const expireTime = Date.now() + (60 * 60 * 1000); // 1 jam
    
    try {
        const apiKeyOrkut = process.env.ORDERKUOTA_API_KEY;
        const usernameOrkut = process.env.ORDERKUOTA_USERNAME;
        const tokenOrkut = process.env.ORDERKUOTA_TOKEN;
        
        const createUrl = `https://orderhostid.my.id/?action=createpayment&apikey=${apiKeyOrkut}&username=${usernameOrkut}&amount=${totalBayar}&token=${tokenOrkut}`;
        console.log(`📡 Create QRIS: ${createUrl}`);
        
        const response = await axios.get(createUrl, { timeout: 15000 });
        console.log('📥 Response API:', JSON.stringify(response.data, null, 2));
        
        if (!response.data?.status) {
            throw new Error(response.data?.message || 'Gagal membuat QRIS');
        }
        
        let qrImageUrl = response.data.result?.qris_image;
        let qrBase64 = null;
        
        if (qrImageUrl) {
            // 🔥 KONVERSI URL KE BASE64
            console.log(`📥 Mengkonversi URL ke Base64: ${qrImageUrl}`);
            qrBase64 = await convertImageUrlToBase64(qrImageUrl);
            
            if (!qrBase64) {
                // Fallback: gunakan URL asli
                qrBase64 = qrImageUrl;
            } else {
                console.log('✅ Berhasil konversi ke Base64');
            }
        }
        
        if (!qrBase64) {
            throw new Error('Gagal mendapatkan QRIS');
        }
        
        // Simpan deposit
        const newDeposit = {
            id: kodeTrx,
            user_id: user.id,
            username: user.username,
            amount: nominal,
            fee: randomFee,
            total_bayar: totalBayar,
            qr_image: qrBase64,  // Langsung base64
            status: 'pending',
            source: 'web',
            created_at: Date.now(),
            expired_at: expireTime
        };
        
        const deposits = readDB(depositsFile);
        deposits.push(newDeposit);
        writeDB(depositsFile, deposits);
        
        // Notifikasi owner
        await sendToOwner(`💰 *DEPOSIT WEB BARU*\n━━━━━━━━━━━━━━━━\n👤 User: ${user.username}\n💰 Jumlah: ${formatRupiah(nominal)}\n💳 Fee: ${formatRupiah(randomFee)}\n💵 Total: ${formatRupiah(totalBayar)}\n🧾 ID: ${kodeTrx}`, { parse_mode: 'Markdown' });
        
        res.json({
            success: true,
            deposit: {
                id: kodeTrx,
                amount: nominal,
                fee: randomFee,
                total_payment: totalBayar,
                qr_image: qrBase64,  // Base64 langsung bisa di <img>
                status: 'pending',
                expired_at: expireTime
            }
        });
        
    } catch (error) {
        console.error('❌ Error create deposit web:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ========== CEK STATUS DEPOSIT VIA WEB ==========
app.post('/api/depo/status', async (req, res) => {
    const { deposit_id, user_id } = req.body;
    
    // Validasi input
    if (!deposit_id) {
        return res.status(400).json({ success: false, error: 'Deposit ID required' });
    }
    if (!user_id) {
        return res.status(400).json({ success: false, error: 'User ID required' });
    }
    
    // Ambil data deposit
    const deposits = readDB(depositsFile);
    const deposit = deposits.find(d => d.id === deposit_id);
    
    if (!deposit) {
        return res.status(404).json({ success: false, error: 'Deposit not found' });
    }
    
    // Validasi kepemilikan
    if (deposit.user_id != user_id) {
        return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    // Jika sudah sukses
    if (deposit.status === 'success') {
        return res.json({ success: true, status: 'success', message: 'Deposit sudah berhasil' });
    }
    
    // Jika sudah dibatalkan
    if (deposit.status === 'canceled') {
        return res.json({ success: true, status: 'canceled', message: 'Deposit sudah dibatalkan' });
    }
    
    // Jika expired
    if (Date.now() > deposit.expired_at && deposit.status === 'pending') {
        deposit.status = 'expired';
        writeDB(depositsFile, deposits);
        return res.json({ success: true, status: 'expired', message: 'Deposit expired' });
    }
    
    // 🔥 CEK MUTASI KE GATEWAY
    try {
        const apiKeyOrkut = process.env.ORDERKUOTA_API_KEY;
        const usernameOrkut = process.env.ORDERKUOTA_USERNAME;
        const tokenOrkut = process.env.ORDERKUOTA_TOKEN;
        
        const mutasiUrl = `https://orderhostid.my.id/?action=mutasiqr&apikey=${apiKeyOrkut}&username=${usernameOrkut}&token=${tokenOrkut}`;
        console.log(`📡 Cek mutasi: ${mutasiUrl}`);
        
        const response = await axios.get(mutasiUrl, { timeout: 15000 });
        
        if (response.data?.status && response.data?.result?.results) {
            // Cari transaksi dengan nominal yang sama
            const found = response.data.result.results.find(t => {
                if (t.status !== "IN") return false;
                // Bersihkan format nominal
                const nominalStr = String(t.kredit || '0').replace(/\./g, '').replace(/,/g, '');
                const nominal = parseInt(nominalStr) || 0;
                return nominal === deposit.total_bayar;
            });
            
            if (found) {
                // Update status deposit
                deposit.status = 'success';
                deposit.paid_at = Date.now();
                writeDB(depositsFile, deposits);
                
                // Tambah saldo user
                const users = readDB(usersFile);
                const user = users.find(u => u.id === deposit.user_id);
                if (user) {
                    const saldoLama = user.balance;
                    user.balance += deposit.amount;
                    writeDB(usersFile, users);
                    
                    console.log(`💰 Saldo ${user.username}: ${formatRupiah(saldoLama)} → ${formatRupiah(user.balance)}`);
                    
                    // Notifikasi ke owner
                    await sendToOwner(`✅ *DEPOSIT WEB BERHASIL*\n━━━━━━━━━━━━━━━━\n👤 User: ${deposit.username}\n💰 Jumlah: ${formatRupiah(deposit.amount)}\n💳 Fee: ${formatRupiah(deposit.fee)}\n💵 Total: ${formatRupiah(deposit.total_bayar)}\n🧾 ID: ${deposit.id}`, { parse_mode: 'Markdown' });
                }
                
                return res.json({ success: true, status: 'success', message: 'Deposit berhasil! Saldo bertambah.' });
            }
        }
        
        return res.json({ success: true, status: 'pending', message: 'Menunggu pembayaran' });
        
    } catch (error) {
        console.error('❌ Error cek status deposit web:', error.message);
        return res.json({ success: true, status: 'pending', message: 'Menunggu pembayaran' });
    }
});
// ========== CANCEL DEPOSIT VIA WEB ==========
app.post('/api/depo/cancel', async (req, res) => {
    const { deposit_id, user_id } = req.body;
    
    // Validasi input
    if (!deposit_id) {
        return res.status(400).json({ success: false, error: 'Deposit ID required' });
    }
    if (!user_id) {
        return res.status(400).json({ success: false, error: 'User ID required' });
    }
    
    // Ambil data deposit
    const deposits = readDB(depositsFile);
    const deposit = deposits.find(d => d.id === deposit_id);
    
    if (!deposit) {
        return res.status(404).json({ success: false, error: 'Deposit not found' });
    }
    
    // Validasi kepemilikan
    if (deposit.user_id != user_id) {
        return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    // Cek status
    if (deposit.status !== 'pending') {
        return res.status(400).json({ 
            success: false, 
            error: `Deposit status ${deposit.status}, tidak bisa dibatalkan` 
        });
    }
    
    // Cek apakah sudah expired
    if (Date.now() > deposit.expired_at) {
        deposit.status = 'expired';
        writeDB(depositsFile, deposits);
        return res.status(400).json({ success: false, error: 'Deposit sudah expired, tidak bisa dibatalkan' });
    }
    
    // Batalkan deposit
    deposit.status = 'canceled';
    deposit.canceled_at = Date.now();
    writeDB(depositsFile, deposits);
    
    // Notifikasi ke owner
    await sendToOwner(`❌ *DEPOSIT WEB DIBATALKAN*\n━━━━━━━━━━━━━━━━\n👤 User: ${deposit.username}\n💰 Jumlah: ${formatRupiah(deposit.amount)}\n💳 Fee: ${formatRupiah(deposit.fee)}\n🧾 ID: ${deposit.id}`, { parse_mode: 'Markdown' });
    
    res.json({ success: true, message: 'Deposit berhasil dibatalkan' });
});

// ========== ADMIN API - DEPOSIT LIST ==========
app.get('/api/admin/deposit/list', verifyAdminApiKey, async (req, res) => {
    const { limit = 500, status } = req.query;
    let deposits = readDB(depositsFile);
    
    if (status) {
        deposits = deposits.filter(d => d.status === status);
    }
    
    deposits.sort((a, b) => b.created_at - a.created_at);
    
    if (limit && !isNaN(limit)) {
        deposits = deposits.slice(0, parseInt(limit));
    }
    
    const stats = {
        total_success: deposits.filter(d => d.status === 'success').length,
        total_pending: deposits.filter(d => d.status === 'pending').length,
        total_expired: deposits.filter(d => d.status === 'expired').length,
        total_canceled: deposits.filter(d => d.status === 'canceled').length,
        total_nominal_success: deposits.filter(d => d.status === 'success').reduce((sum, d) => sum + (d.amount || 0), 0)
    };
    
    res.json({
        success: true,
        stats,
        data: deposits.map(d => ({
            id: d.id,
            user_id: d.user_id,
            username: d.username,
            amount: d.amount,
            fee: d.fee,
            total_payment: d.total_bayar || d.total_payment,
            status: d.status,
            created_at: d.created_at,
            expired_at: d.expired_at
        }))
    });
});

// ========== ADMIN API - WITHDRAWALS LIST ==========
app.get('/api/admin/withdrawals/list', verifyAdminApiKey, async (req, res) => {
    const withdrawals = readDB(withdrawalsFile);
    
    withdrawals.sort((a, b) => b.created_at - a.created_at);
    
    const stats = {
        total_success: withdrawals.filter(w => w.status === 'success').length,
        total_pending: withdrawals.filter(w => w.status === 'pending').length,
        total_failed: withdrawals.filter(w => w.status === 'failed').length,
        total_nominal_success: withdrawals.filter(w => w.status === 'success').reduce((sum, w) => sum + (w.amount || 0), 0)
    };
    
    res.json({
        success: true,
        stats,
        data: withdrawals.map(w => ({
            id: w.id,
            user_id: w.user_id,
            username: w.username,
            amount: w.amount,
            fee: w.fee,
            total_diterima: w.total_diterima,
            operator: w.operator,
            account_number: w.account_number,
            status: w.status,
            created_at: w.created_at
        }))
    });
});
// ====================================================
// 🔑 REGENERATE API KEY
// ====================================================
app.post('/api/regenerate-apikey', async (req, res) => {
  const { user_id } = req.body;
  const apiKey = req.headers['x-api-key'];
  
  if (!user_id && !apiKey) {
    return res.status(401).json({ success: false, error: 'User ID or API Key required' });
  }
  
  let user = null;
  const users = readDB(usersFile);
  
  if (apiKey) {
    user = users.find(u => u.apiKey === apiKey);
  } else if (user_id) {
    user = users.find(u => u.id == user_id);
  }
  
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  
  const newApiKey = 'dp_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 8);
  
  user.apiKey = newApiKey;
  writeDB(usersFile, users);
  
  await sendToOwner(`🔄 *API KEY DIGENERATE*\n━━━━━━━━━━━━━━━━\n👤 User: ${user.username}\n🆔 User ID: ${user.id}\n🔑 API Key Baru: ${newApiKey}`, { parse_mode: 'Markdown' });
  
  res.json({ 
    success: true, 
    message: 'API Key berhasil digenerate ulang',
    apiKey: newApiKey
  });
});

// ====================================================
// 💸 WITHDRAWAL SYSTEM (FIX)
// ====================================================

// ====================================================
// 💸 WITHDRAWAL SYSTEM (FIX - SALDO LANGSUNG BERKURANG)
// ====================================================

// CREATE WITHDRAWAL
app.post('/api/withdraw/create', async (req, res) => {
  const { user_id, amount, operator, account_number } = req.body;
  
  console.log('📥 Withdraw request:', { user_id, amount, operator, account_number });
  
  // Validasi
  if (!user_id) {
    return res.status(400).json({ success: false, error: 'User ID required' });
  }
  if (!amount || amount < MIN_WITHDRAW) {
    return res.status(400).json({ success: false, error: `Minimal withdraw ${formatRupiah(MIN_WITHDRAW)}` });
  }
  if (amount > MAX_WITHDRAW) {
    return res.status(400).json({ success: false, error: `Maksimal withdraw ${formatRupiah(MAX_WITHDRAW)}` });
  }
  if (!operator || !['dana', 'ovo', 'gopay'].includes(operator)) {
    return res.status(400).json({ success: false, error: 'Pilih operator: dana, ovo, atau gopay' });
  }
  if (!account_number) {
    return res.status(400).json({ success: false, error: 'Nomor tujuan harus diisi' });
  }
  
  // Cari user
  const users = readDB(usersFile);
  const user = users.find(u => u.id == user_id);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  
  // Hitung total yang diterima user (setelah fee)
  const totalDiterima = amount - WITHDRAWAL_FEE;
  if (totalDiterima < 0) {
    return res.status(400).json({ success: false, error: 'Saldo tidak cukup untuk fee' });
  }
  if (user.balance < amount) {
    return res.status(400).json({ success: false, error: 'Saldo tidak cukup' });
  }
  
  // Generate ID transaksi
  const kodeTrx = generateTransactionId('WD');
  
  // Simpan withdraw ke database
  const newWithdraw = {
    id: kodeTrx,
    user_id: user.id,
    username: user.username,
    amount: amount,
    fee: WITHDRAWAL_FEE,
    total_diterima: totalDiterima,
    operator: operator,
    account_number: account_number,
    status: 'pending',
    created_at: Date.now()
  };
  
  const withdrawals = readDB(withdrawalsFile);
  withdrawals.push(newWithdraw);
  writeDB(withdrawalsFile, withdrawals);
  
  // ===== KURANGI SALDO USER LANGSUNG =====
  const saldoLama = user.balance;
  user.balance -= amount;
  writeDB(usersFile, users);
  console.log(`💰 Saldo user ${user.username} berkurang: ${formatRupiah(saldoLama)} → ${formatRupiah(user.balance)}`);
  
  // Notifikasi ke owner (via Telegram)
  await sendToOwner(`💸 *PENARIKAN BARU*\n━━━━━━━━━━━━━━━━\n👤 User: ${user.username}\n🆔 ID: ${user.id}\n💰 Jumlah: ${formatRupiah(amount)}\n💳 Fee: ${formatRupiah(WITHDRAWAL_FEE)}\n💵 Diterima: ${formatRupiah(totalDiterima)}\n🏦 Operator: ${operator.toUpperCase()}\n📱 No Tujuan: ${account_number}\n🧾 ID: ${kodeTrx}\n💵 Saldo Baru: ${formatRupiah(user.balance)}`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Proses", callback_data: `process_wd_${kodeTrx}` },
          { text: "❌ Gagal", callback_data: `fail_wd_${kodeTrx}` }
        ]
      ]
    }
  });
  
  // Response ke frontend (TANPA notifikasi ke user Telegram)
  res.json({ 
    success: true, 
    withdraw: { 
      id: kodeTrx, 
      amount: amount, 
      fee: WITHDRAWAL_FEE, 
      total_diterima: totalDiterima, 
      operator: operator, 
      account_number: account_number, 
      status: 'pending' 
    } 
  });
});
// GET RIWAYAT DEPOSIT
app.get('/api/history/deposits/:user_id', (req, res) => {
  const deposits = readDB(depositsFile);
  const userDeposits = deposits.filter(d => d.user_id == req.params.user_id);
  res.json(userDeposits.sort((a, b) => b.created_at - a.created_at));
});

// GET RIWAYAT WITHDRAW
app.get('/api/history/withdrawals/:user_id', (req, res) => {
  const withdrawals = readDB(withdrawalsFile);
  const userWithdrawals = withdrawals.filter(w => w.user_id == req.params.user_id);
  res.json(userWithdrawals.sort((a, b) => b.created_at - a.created_at));
});

// CHAT CS
app.post('/api/chat/send', (req, res) => {
  const { user_id, username, message } = req.body;
  const chats = readDB(chatsFile);
  const newChat = { id: Date.now(), user_id, username, message, from_owner: false, timestamp: Date.now() };
  chats.push(newChat);
  writeDB(chatsFile, chats);
  
  sendToOwner(`💬 *PESAN DARI USER*\n━━━━━━━━━━━━━━━━\n👤 ${username}\n💬 ${message}`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: "Balas", callback_data: `reply_${user_id}` }]]
    }
  });
  res.json({ success: true });
});

app.get('/api/chat/conversation/:user_id', (req, res) => {
  const chats = readDB(chatsFile);
  const userChats = chats.filter(c => c.user_id == req.params.user_id);
  res.json(userChats);
});

app.post('/api/chat/reply', (req, res) => {
  const { user_id, message } = req.body;
  const chats = readDB(chatsFile);
  const newChat = { id: Date.now(), user_id, username: 'Admin', message, from_owner: true, timestamp: Date.now() };
  chats.push(newChat);
  writeDB(chatsFile, chats);
  res.json({ success: true });
});

// ========== ADMIN LOGIN ENDPOINT ==========
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    
    const adminUsername = process.env.ADMIN_USERNAME || 'ytta';
    const adminPassword = process.env.ADMIN_PASSWORD || 'ytta';
    
    if (username === adminUsername && password === adminPassword) {
        res.json({ 
            success: true, 
            message: 'Login berhasil',
            adminToken: process.env.ADMIN_API_KEY
        });
    } else {
        res.status(401).json({ 
            success: false, 
            error: 'Username atau password salah' 
        });
    }
});
// ========== KONFIGURASI ADMIN API ==========
// Admin API Key - simpan di .env untuk keamanan
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'admin_digitalpedia_2024_secret_key_123';

// Fungsi verifikasi admin API key
function verifyAdminApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.apikey;
    
    if (!apiKey) {
        return res.status(401).json({ 
            success: false, 
            error: 'Admin API Key required',
            hint: 'Masukkan x-api-key header atau parameter apikey'
        });
    }
    
    if (apiKey !== ADMIN_API_KEY) {
        return res.status(403).json({ 
            success: false, 
            error: 'Invalid Admin API Key' 
        });
    }
    
    next();
}

// Helper: cari user berdasarkan ID atau username
function findUserByIdOrUsername(identifier) {
    const users = readDB(usersFile);
    // Coba cari berdasarkan ID (angka)
    if (!isNaN(identifier)) {
        const user = users.find(u => u.id == identifier);
        if (user) return user;
    }
    // Cari berdasarkan username
    return users.find(u => u.username.toLowerCase() === identifier.toLowerCase());
}

// ========== ADMIN API ENDPOINTS ==========

/**
 * GET /api/admin/addsaldo
 * Menambah saldo user
 * Parameter: userid (string), nominal (number)
 * Contoh: /api/admin/addsaldo?userid=wilzz&nominal=50000
 */
app.get('/api/admin/addsaldo', verifyAdminApiKey, async (req, res) => {
    const { userid, nominal } = req.query;
    
    if (!userid) {
        return res.status(400).json({ 
            success: false, 
            error: 'Parameter userid diperlukan (username atau ID)' 
        });
    }
    
    if (!nominal || isNaN(nominal) || parseInt(nominal) <= 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'Parameter nominal harus berupa angka positif' 
        });
    }
    
    const amount = parseInt(nominal);
    const user = findUserByIdOrUsername(userid);
    
    if (!user) {
        return res.status(404).json({ 
            success: false, 
            error: `User dengan ID/Username "${userid}" tidak ditemukan` 
        });
    }
    
    const users = readDB(usersFile);
    const userIndex = users.findIndex(u => u.id === user.id);
    const saldoLama = user.balance;
    
    users[userIndex].balance += amount;
    writeDB(usersFile, users);
    
    // Catat histori transaksi admin (opsional)
    const adminLogs = readDB(adminLogsFile);
    adminLogs.push({
        id: Date.now(),
        action: 'addsaldo',
        admin_api: req.headers['x-api-key'] || req.query.apikey,
        target_user_id: user.id,
        target_username: user.username,
        amount: amount,
        old_balance: saldoLama,
        new_balance: users[userIndex].balance,
        timestamp: Date.now(),
        ip: req.ip || req.connection.remoteAddress
    });
    writeDB(adminLogsFile, adminLogs);
    
    // Kirim notifikasi ke owner Telegram
    await sendToOwner(`💰 *ADMIN: TAMBAH SALDO*\n━━━━━━━━━━━━━━━━\n👤 Target: ${user.username} (ID: ${user.id})\n💰 Nominal: +${formatRupiah(amount)}\n💵 Saldo Baru: ${formatRupiah(users[userIndex].balance)}\n🌐 IP: ${req.ip || '-'}`, { parse_mode: 'Markdown' });
    
    res.json({
        success: true,
        message: 'Saldo berhasil ditambahkan',
        data: {
            user_id: user.id,
            username: user.username,
            old_balance: saldoLama,
            added_amount: amount,
            new_balance: users[userIndex].balance
        }
    });
});

/**
 * POST /api/admin/addsaldo (version with JSON body)
 * Contoh: POST /api/admin/addsaldo dengan body {"userid": "wilzz", "nominal": 50000}
 */
app.post('/api/admin/addsaldo', verifyAdminApiKey, async (req, res) => {
    const { userid, nominal } = req.body;
    
    if (!userid) {
        return res.status(400).json({ 
            success: false, 
            error: 'Parameter userid diperlukan (username atau ID)' 
        });
    }
    
    if (!nominal || isNaN(nominal) || parseInt(nominal) <= 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'Parameter nominal harus berupa angka positif' 
        });
    }
    
    const amount = parseInt(nominal);
    const user = findUserByIdOrUsername(userid);
    
    if (!user) {
        return res.status(404).json({ 
            success: false, 
            error: `User dengan ID/Username "${userid}" tidak ditemukan` 
        });
    }
    
    const users = readDB(usersFile);
    const userIndex = users.findIndex(u => u.id === user.id);
    const saldoLama = user.balance;
    
    users[userIndex].balance += amount;
    writeDB(usersFile, users);
    
    const adminLogs = readDB(adminLogsFile);
    adminLogs.push({
        id: Date.now(),
        action: 'addsaldo',
        target_user_id: user.id,
        target_username: user.username,
        amount: amount,
        old_balance: saldoLama,
        new_balance: users[userIndex].balance,
        timestamp: Date.now(),
        ip: req.ip || req.connection.remoteAddress
    });
    writeDB(adminLogsFile, adminLogs);
    
    await sendToOwner(`💰 *ADMIN: TAMBAH SALDO*\n👤 Target: ${user.username}\n💰 Nominal: +${formatRupiah(amount)}\n💵 Saldo Baru: ${formatRupiah(users[userIndex].balance)}`, { parse_mode: 'Markdown' });
    
    res.json({
        success: true,
        message: 'Saldo berhasil ditambahkan',
        data: {
            user_id: user.id,
            username: user.username,
            old_balance: saldoLama,
            added_amount: amount,
            new_balance: users[userIndex].balance
        }
    });
});

/**
 * GET /api/admin/delsaldo
 * Mengurangi saldo user
 * Parameter: userid (string), nominal (number)
 */
app.get('/api/admin/delsaldo', verifyAdminApiKey, async (req, res) => {
    const { userid, nominal } = req.query;
    
    if (!userid) {
        return res.status(400).json({ 
            success: false, 
            error: 'Parameter userid diperlukan (username atau ID)' 
        });
    }
    
    if (!nominal || isNaN(nominal) || parseInt(nominal) <= 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'Parameter nominal harus berupa angka positif' 
        });
    }
    
    const amount = parseInt(nominal);
    const user = findUserByIdOrUsername(userid);
    
    if (!user) {
        return res.status(404).json({ 
            success: false, 
            error: `User dengan ID/Username "${userid}" tidak ditemukan` 
        });
    }
    
    const users = readDB(usersFile);
    const userIndex = users.findIndex(u => u.id === user.id);
    
    if (users[userIndex].balance < amount) {
        return res.status(400).json({ 
            success: false, 
            error: `Saldo tidak cukup! Saldo ${user.username}: ${formatRupiah(users[userIndex].balance)}` 
        });
    }
    
    const saldoLama = users[userIndex].balance;
    users[userIndex].balance -= amount;
    writeDB(usersFile, users);
    
    const adminLogs = readDB(adminLogsFile);
    adminLogs.push({
        id: Date.now(),
        action: 'delsaldo',
        target_user_id: user.id,
        target_username: user.username,
        amount: amount,
        old_balance: saldoLama,
        new_balance: users[userIndex].balance,
        timestamp: Date.now()
    });
    writeDB(adminLogsFile, adminLogs);
    
    await sendToOwner(`💸 *ADMIN: KURANGI SALDO*\n👤 Target: ${user.username}\n💰 Nominal: -${formatRupiah(amount)}\n💵 Saldo Baru: ${formatRupiah(users[userIndex].balance)}`, { parse_mode: 'Markdown' });
    
    res.json({
        success: true,
        message: 'Saldo berhasil dikurangi',
        data: {
            user_id: user.id,
            username: user.username,
            old_balance: saldoLama,
            deducted_amount: amount,
            new_balance: users[userIndex].balance
        }
    });
});

/**
 * GET /api/admin/ceksaldo
 * Cek saldo user
 * Parameter: userid (string)
 */
app.get('/api/admin/ceksaldo', verifyAdminApiKey, async (req, res) => {
    const { userid } = req.query;
    
    if (!userid) {
        return res.status(400).json({ 
            success: false, 
            error: 'Parameter userid diperlukan (username atau ID)' 
        });
    }
    
    const user = findUserByIdOrUsername(userid);
    
    if (!user) {
        return res.status(404).json({ 
            success: false, 
            error: `User dengan ID/Username "${userid}" tidak ditemukan` 
        });
    }
    
    // Hitung statistik user
    const orders = readDB(ordersFile);
    const userOrders = orders.filter(o => o.user_id === user.id);
    const totalSpent = userOrders.reduce((sum, o) => sum + (o.price || 0), 0);
    const totalOrders = userOrders.length;
    
    res.json({
        success: true,
        data: {
            user_id: user.id,
            username: user.username,
            email: user.email || '-',
            balance: user.balance,
            balance_formatted: formatRupiah(user.balance),
            total_orders: totalOrders,
            total_spent: totalSpent,
            total_spent_formatted: formatRupiah(totalSpent),
            api_key: user.apiKey,
            created_at: user.created_at,
            created_at_formatted: new Date(user.created_at).toLocaleString('id-ID')
        }
    });
});

/**
 * GET /api/admin/listuser
 * Daftar semua user (dengan filter)
 * Parameter: limit (optional), search (optional), sort_by (optional: balance, username, created_at)
 */
app.get('/api/admin/listuser', verifyAdminApiKey, async (req, res) => {
    const { limit, search, sort_by = 'balance', order = 'desc' } = req.query;
    
    let users = readDB(usersFile);
    
    // Filter search
    if (search) {
        const searchLower = search.toLowerCase();
        users = users.filter(u => 
            u.username.toLowerCase().includes(searchLower) || 
            (u.email && u.email.toLowerCase().includes(searchLower)) ||
            u.id.toString().includes(search)
        );
    }
    
    // Sorting
    users.sort((a, b) => {
        let aVal = a[sort_by] || 0;
        let bVal = b[sort_by] || 0;
        if (sort_by === 'username') {
            aVal = a.username.toLowerCase();
            bVal = b.username.toLowerCase();
            return order === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
        }
        return order === 'desc' ? bVal - aVal : aVal - bVal;
    });
    
    // Hitung total saldo
    const totalSaldo = users.reduce((sum, u) => sum + (u.balance || 0), 0);
    
    // Limit
    let resultUsers = users;
    if (limit && !isNaN(limit)) {
        resultUsers = users.slice(0, parseInt(limit));
    }
    
    res.json({
        success: true,
        summary: {
            total_users: users.length,
            total_balance: totalSaldo,
            total_balance_formatted: formatRupiah(totalSaldo)
        },
        data: resultUsers.map(u => ({
            id: u.id,
            username: u.username,
            email: u.email || '-',
            balance: u.balance,
            balance_formatted: formatRupiah(u.balance),
            api_key: u.apiKey,
            created_at: u.created_at
        }))
    });
});

/**
 * GET /api/admin/logs
 * Lihat histori transaksi admin
 * Parameter: limit (optional, default 50)
 */
app.get('/api/admin/logs', verifyAdminApiKey, async (req, res) => {
    const { limit = 50 } = req.query;
    let logs = readDB(adminLogsFile);
    
    logs.sort((a, b) => b.timestamp - a.timestamp);
    
    if (limit && !isNaN(limit)) {
        logs = logs.slice(0, parseInt(limit));
    }
    
    res.json({
        success: true,
        total_logs: logs.length,
        data: logs
    });
});
// ========== BOT COMMAND UNTUK MANAJEMEN SALDO ==========

// Helper: cari user berdasarkan ID atau username
function findUser(identifier) {
    const users = readDB(usersFile);
    // Coba cari berdasarkan ID (angka)
    if (!isNaN(identifier)) {
        const user = users.find(u => u.id == identifier);
        if (user) return user;
    }
    // Cari berdasarkan username
    return users.find(u => u.username.toLowerCase() === identifier.toLowerCase());
}

// /addsaldo <user_id> <amount>
bot.onText(/\/addsaldo (\S+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Hanya owner yang bisa akses
    if (userId.toString() !== ADMIN_ID) {
        return bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke command ini.');
    }
    
    const identifier = match[1];
    const amount = parseInt(match[2]);
    
    if (amount <= 0) {
        return bot.sendMessage(chatId, '❌ Nominal harus lebih dari 0');
    }
    
    const user = findUser(identifier);
    if (!user) {
        return bot.sendMessage(chatId, `❌ User dengan ID/Username "${identifier}" tidak ditemukan`);
    }
    
    const users = readDB(usersFile);
    const userIndex = users.findIndex(u => u.id === user.id);
    
    const saldoLama = user.balance;
    users[userIndex].balance += amount;
    writeDB(usersFile, users);
    
    const message = `
✅ *TAMBAH SALDO BERHASIL*
━━━━━━━━━━━━━━━━
👤 *Username:* ${user.username}
🆔 *User ID:* ${user.id}
💰 *Nominal:* +${formatRupiah(amount)}
💵 *Saldo Lama:* ${formatRupiah(saldoLama)}
💵 *Saldo Baru:* ${formatRupiah(users[userIndex].balance)}
━━━━━━━━━━━━━━━━
📅 *Waktu:* ${new Date().toLocaleString('id-ID')}
    `;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    
    // Notifikasi ke user yang bersangkutan (opsional)
    try {
        await bot.sendMessage(user.id, `💰 Saldo Anda telah ditambah ${formatRupiah(amount)} oleh Admin.\n💵 Saldo sekarang: ${formatRupiah(users[userIndex].balance)}`);
    } catch(e) { console.log('User belum start bot'); }
});

// /delsaldo <user_id> <amount>
bot.onText(/\/delsaldo (\S+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Hanya owner yang bisa akses
    if (userId.toString() !== ADMIN_ID) {
        return bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke command ini.');
    }
    
    const identifier = match[1];
    const amount = parseInt(match[2]);
    
    if (amount <= 0) {
        return bot.sendMessage(chatId, '❌ Nominal harus lebih dari 0');
    }
    
    const user = findUser(identifier);
    if (!user) {
        return bot.sendMessage(chatId, `❌ User dengan ID/Username "${identifier}" tidak ditemukan`);
    }
    
    const users = readDB(usersFile);
    const userIndex = users.findIndex(u => u.id === user.id);
    
    if (users[userIndex].balance < amount) {
        return bot.sendMessage(chatId, `❌ Saldo tidak cukup!\n💵 Saldo ${user.username}: ${formatRupiah(users[userIndex].balance)}`);
    }
    
    const saldoLama = users[userIndex].balance;
    users[userIndex].balance -= amount;
    writeDB(usersFile, users);
    
    const message = `
✅ *KURANGI SALDO BERHASIL*
━━━━━━━━━━━━━━━━
👤 *Username:* ${user.username}
🆔 *User ID:* ${user.id}
💰 *Nominal:* -${formatRupiah(amount)}
💵 *Saldo Lama:* ${formatRupiah(saldoLama)}
💵 *Saldo Baru:* ${formatRupiah(users[userIndex].balance)}
━━━━━━━━━━━━━━━━
📅 *Waktu:* ${new Date().toLocaleString('id-ID')}
    `;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    
    // Notifikasi ke user yang bersangkutan (opsional)
    try {
        await bot.sendMessage(user.id, `💰 Saldo Anda dikurangi ${formatRupiah(amount)} oleh Admin.\n💵 Saldo sekarang: ${formatRupiah(users[userIndex].balance)}`);
    } catch(e) { console.log('User belum start bot'); }
});

// /ceksaldoall - lihat semua user (opsional)
bot.onText(/\/ceksaldoall/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (userId.toString() !== ADMIN_ID) {
        return bot.sendMessage(chatId, '❌ Anda tidak memiliki akses ke command ini.');
    }
    
    const users = readDB(usersFile);
    const totalSaldo = users.reduce((sum, u) => sum + (u.balance || 0), 0);
    
    // Urutkan berdasarkan saldo terbanyak
    const sortedUsers = [...users].sort((a, b) => (b.balance || 0) - (a.balance || 0));
    
    let userList = '';
    for (let i = 0; i < Math.min(20, sortedUsers.length); i++) {
        const u = sortedUsers[i];
        userList += `\n${i+1}. ${u.username} - ${formatRupiah(u.balance || 0)}`;
    }
    
    const message = `
📊 *DAFTAR SEMUA USER*
━━━━━━━━━━━━━━━━
👥 *Total User:* ${users.length} orang
💰 *Total Saldo:* ${formatRupiah(totalSaldo)}
━━━━━━━━━━━━━━━━
*Top 20 Saldo:*
${userList || 'Tidak ada data'}
━━━━━━━━━━━━━━━━
📅 *Update:* ${new Date().toLocaleString('id-ID')}
    `;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// /help (update dengan command baru)
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    let helpText = `
🤖 *COMMAND BOT DIGITAL PEDIA*
━━━━━━━━━━━━━━━━
👑 *Command Admin (Owner Only):*
/addsaldo <id/username> <jumlah>
/delsaldo <id/username> <jumlah>
/ceksaldo <id/username>
━━━━━━━━━━━━━━━━
📅 *Info:* ${new Date().toLocaleString('id-ID')}
    `;
    
    if (userId.toString() === ADMIN_ID) {
        helpText += `\n🔐 *Total User:* ${readDB(usersFile).length} orang`;
    }
    
    await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});
// ========== BOT HANDLER ==========
bot.on('callback_query', async (cb) => {
  const data = cb.data;
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  
  try {
    // ========== PROSES WITHDRAW (SUKSES) ==========
    if (data.startsWith('process_wd_')) {
      const wdId = data.replace('process_wd_', '');
      console.log(`✅ Memproses penarikan: ${wdId}`);
      
      const withdrawals = readDB(withdrawalsFile);
      const withdraw = withdrawals.find(w => w.id === wdId);
      
      if (!withdraw) {
        await bot.answerCallbackQuery(cb.id, { text: '❌ Data penarikan tidak ditemukan!', show_alert: true });
        return;
      }
      
      if (withdraw.status !== 'pending') {
        await bot.answerCallbackQuery(cb.id, { text: '⚠️ Penarikan sudah diproses sebelumnya!', show_alert: true });
        return;
      }
      
      // Update status
      withdraw.status = 'success';
      writeDB(withdrawalsFile, withdrawals);
      
      // ===== HAPUS NOTIFIKASI KE USER (KARENA INI WEB) =====
      // Tidak ada bot.sendMessage ke user
      
      // Update pesan callback
      await bot.editMessageText(`✅ *Penarikan ${wdId} telah diproses!*\n\nStatus: SUCCESS\n\nSaldo sudah dikurangi saat pengajuan.`, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
      });
      
      await bot.answerCallbackQuery(cb.id, { text: '✅ Penarikan berhasil diproses!', show_alert: false });
    }
    
    // ========== FAIL WITHDRAW (GAGAL) ==========
    else if (data.startsWith('fail_wd_')) {
      const wdId = data.replace('fail_wd_', '');
      console.log(`❌ Membatalkan penarikan: ${wdId}`);
      
      const withdrawals = readDB(withdrawalsFile);
      const withdraw = withdrawals.find(w => w.id === wdId);
      
      if (!withdraw) {
        await bot.answerCallbackQuery(cb.id, { text: '❌ Data penarikan tidak ditemukan!', show_alert: true });
        return;
      }
      
      if (withdraw.status !== 'pending') {
        await bot.answerCallbackQuery(cb.id, { text: '⚠️ Penarikan sudah diproses sebelumnya!', show_alert: true });
        return;
      }
      
      // Update status menjadi failed
      withdraw.status = 'failed';
      writeDB(withdrawalsFile, withdrawals);
      
      // ===== KEMBALIKAN SALDO USER =====
      const users = readDB(usersFile);
      const user = users.find(u => u.id === withdraw.user_id);
      if (user) {
        const saldoLama = user.balance;
        user.balance += withdraw.amount;
        writeDB(usersFile, users);
        console.log(`💰 Saldo dikembalikan ke user ${user.username}: ${formatRupiah(saldoLama)} → ${formatRupiah(user.balance)}`);
      }
      
      // ===== HAPUS NOTIFIKASI KE USER =====
      // Tidak ada bot.sendMessage ke user
      
      // Update pesan callback
      await bot.editMessageText(`❌ *Penarikan ${wdId} GAGAL!*\n\nSaldo telah dikembalikan ke user.`, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
      });
      
      await bot.answerCallbackQuery(cb.id, { text: '❌ Penarikan gagal, saldo dikembalikan!', show_alert: false });
    }
    
    // ========== REPLY CHAT ==========
    else if (data.startsWith('reply_')) {
      const userId = data.split('_')[1];
      await bot.sendMessage(chatId, `Balas untuk user ID ${userId}:`, { reply_markup: { force_reply: true } });
      bot.once('message', async (msg) => {
        if (msg.reply_to_message && msg.text) {
          await axios.post(`http://localhost:${process.env.PORT || 3000}/api/chat/reply`, {
            user_id: parseInt(userId),
            message: msg.text
          });
          await bot.sendMessage(chatId, "✅ Balasan terkirim ke user.");
        }
      });
      await bot.answerCallbackQuery(cb.id);
    }
    
  } catch (error) {
    console.error('❌ Callback error:', error);
    await bot.answerCallbackQuery(cb.id, { text: '❌ Terjadi kesalahan!', show_alert: true });
  }
});
// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server berjalan di port ${PORT}`);
  sendToOwner('🚀 Digital Pedia H2H Payment Gateway telah dimulai.');
});
