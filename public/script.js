// Global functions untuk semua halaman
let currentUser = null;

async function loadUser() {
    const userStr = localStorage.getItem('user');
    if (!userStr) {
        window.location.href = '/';
        return false;
    }
    currentUser = JSON.parse(userStr);
    
    // Update balance di semua halaman
    const balanceElements = document.querySelectorAll('#userBalance, #balance');
    balanceElements.forEach(el => {
        if (el) el.innerText = formatRupiah(currentUser.balance);
    });
    
    const usernameElements = document.querySelectorAll('#username, #userName');
    usernameElements.forEach(el => {
        if (el) el.innerText = currentUser.username;
    });
    
    return true;
}

async function refreshBalance() {
    if (!currentUser) return;
    try {
        const res = await axios.get(`/api/user/${currentUser.id}`);
        if (res.data) {
            currentUser.balance = res.data.balance;
            localStorage.setItem('user', JSON.stringify(currentUser));
            const balanceElements = document.querySelectorAll('#userBalance, #balance');
            balanceElements.forEach(el => {
                if (el) el.innerText = formatRupiah(currentUser.balance);
            });
        }
    } catch(e) {
        console.error('Refresh balance error:', e);
    }
}

function logout() {
    localStorage.removeItem('user');
    window.location.href = '/';
}

function formatRupiah(angka) {
    if (angka === undefined || angka === null) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(angka);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getStatusBadge(status) {
    const statusMap = {
        'success': '<span class="badge bg-success">✅ Sukses</span>',
        'pending': '<span class="badge bg-warning">⏳ Pending</span>',
        'processing': '<span class="badge bg-info">⚙️ Processing</span>',
        'failed': '<span class="badge bg-danger">❌ Gagal</span>',
        'cancel': '<span class="badge bg-secondary">🚫 Dibatalkan</span>',
        'expired': '<span class="badge bg-secondary">⏰ Expired</span>'
    };
    return statusMap[status] || `<span class="badge bg-secondary">${status}</span>`;
}

// Auto refresh balance setiap 30 detik
if (typeof setInterval !== 'undefined') {
    setInterval(() => {
        if (currentUser) refreshBalance();
    }, 30000);
}