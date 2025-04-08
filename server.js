const WebSocket = require('ws');
const crypto = require('crypto');
const { type } = require('os');

// Inisialisasi server WebSocket
const server = new WebSocket.Server({ port: 8081,host:'0.0.0.0' });

// Data struktur untuk menyimpan state blockchain
let blockchain = [];
let pendingTransactions = [];
let users = [];

// Inisialisasi genesis block
const genesisBlock = {
  index: 0,
  timestamp: new Date().toISOString(),
  transactions: [],
  previousHash: '0',
  hash: '0',
  nonce: 0,
  minedBy: 'system'
};
blockchain.push(genesisBlock);

// Fungsi untuk menghitung hash dari block
function calculateHash(block) {
  const data = block.index + block.previousHash + block.timestamp + JSON.stringify(block.transactions) + block.nonce;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Fungsi untuk mining block (proof of work)
function mineBlock(block) {
  const difficulty = 2; // Tingkat kesulitan (jumlah nol di awal hash)
  const target = '0'.repeat(difficulty);
  
  while (block.hash.substring(0, difficulty) !== target) {
    block.nonce++;
    block.hash = calculateHash(block);
  }
  
  return block;
}

// Fungsi untuk membuat block baru
function createNewBlock(userId) {
  const lastBlock = blockchain[blockchain.length - 1];
  const newBlock = {
    index: lastBlock.index + 1,
    timestamp: new Date().toISOString(),
    transactions: [...pendingTransactions],
    previousHash: lastBlock.hash,
    hash: '',
    nonce: 0,
    minedBy: userId
  };
  
  // Hitung hash awal
  newBlock.hash = calculateHash(newBlock);
  
  // Mining block
  const minedBlock = mineBlock(newBlock);
  
  // Menambahkan block ke blockchain
  blockchain.push(minedBlock);
  
  // Mengosongkan daftar transaksi tertunda
  pendingTransactions = [];
  
  return minedBlock;
}

function calculateBalance(userId){
  let balance = 100;
  for(let block of blockchain){
     for(let tsx of block.transactions){
        if(tsx.sender === userId){
          balance -= tsx.amount;
        }
        if(tsx.recipient === userId){
          balance += tsx.amount;
        }
     }
  }

  for(let tsx of pendingTransactions){
    if(tsx.sender === userId){
      balance -= tsx.amount;
    }
    // if(tsx.recipient === userId){
    //   balance += tsx.amount;
    // }
  }
  return balance;
}

// Fungsi untuk validasi blockchain
function isValidChain() {
  for (let i = 1; i < blockchain.length; i++) {
    const currentBlock = blockchain[i];
    const previousBlock = blockchain[i - 1];
    
    // Verifikasi hash
    if (currentBlock.hash !== calculateHash(currentBlock)) {
      return false;
    }
    
    // Verifikasi referensi hash sebelumnya
    if (currentBlock.previousHash !== previousBlock.hash) {
      return false;
    }
  }
  
  return true;
}

// Fungsi untuk broadcast data ke semua klien
function broadcast(data) {
  server.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Fungsi untuk memperbarui daftar pengguna dan broadcast ke semua klien
function updateUsers() {
  broadcast({
    type: 'USER_LIST',
    data: users
  });
}

// Fungsi untuk memperbarui blockchain dan broadcast ke semua klien
function updateBlockchain() {
  broadcast({
    type: 'BLOCKCHAIN_UPDATE',
    data: blockchain
  });
}

// Fungsi untuk memperbarui transaksi tertunda dan broadcast ke semua klien
function updatePendingTransactions() {
  broadcast({
    type: 'PENDING_TRANSACTIONS',
    data: pendingTransactions
  });
}

// Event handler untuk koneksi baru
server.on('connection', (socket) => {
  console.log('New client connected');
  
  // Event handler untuk pesan dari klien
  socket.on('message', (data) => {
    const message = JSON.parse(data);
    
    switch (message.type) {
      case 'JOIN':
        // Tambahkan pengguna baru
        const userId = message.userId;
        const existingUser = users.find(user => user.id === userId);
        if(!existingUser){
        const newUser = {
          id: userId,
          connectedAt: message.timestamp,
          socket: socket,
        };

        users.push(newUser);
        console.log(`User ${userId} joined (new)`);
      }else{
        existingUser.socket = socket;
        console.log(`User ${userId} reconnected`);
      }
        socket.userId = userId;
        // Kirim status terkini ke pengguna baru
        socket.send(JSON.stringify({
          type: 'BLOCKCHAIN_UPDATE',
          data: blockchain
        }));
        
        socket.send(JSON.stringify({
          type: 'PENDING_TRANSACTIONS',
          data: pendingTransactions
        }));

        socket.send(JSON.stringify({
          type:'BALANCE_UPDATE',
          balance: calculateBalance(userId)
        }))
        
        // Perbarui dan broadcast daftar pengguna
        updateUsers();
        console.log(`User ${userId} joined`);
        console.log(users)
        break;
        
      case 'NEW_TRANSACTION':
        // Tambahkan transaksi baru ke daftar transaksi tertunda
        pendingTransactions.push(message.transaction);
        
        // Broadcast transaksi baru kepada semua klien
        broadcast({
          type: 'NEW_TRANSACTION',
          transaction: message.transaction
        });
        const involvedUsers = [message.transaction.sender, message.transaction.recipient];
        console.log(involvedUsers)
        involvedUsers.forEach(id => {
          const user = users.find(u => u.id === id);
          if (user && user.socket.readyState === WebSocket.OPEN) {
            console.log('Balance for', id, ':', calculateBalance(id));
            user.socket.send(JSON.stringify({
              type: 'BALANCE_UPDATE',
              balance: calculateBalance(id)
            }));
          }
        });
        // Perbarui daftar transaksi tertunda
        updatePendingTransactions();
        console.log(`New transaction: ${message.transaction.sender} -> ${message.transaction.recipient} (${message.transaction.amount})`);
        break;
        
      case 'MINE_BLOCK':
        // Periksa apakah ada transaksi tertunda
        if (pendingTransactions.length === 0) {
          socket.send(JSON.stringify({
            type: 'ERROR',
            message: 'No pending transactions to mine'
          }));
          return;
        }
        
        // Buat dan tambahkan block baru
        const newBlock = createNewBlock(message.userId);
        
        // Perbarui blockchain
        updateBlockchain();
        
        // Perbarui daftar transaksi tertunda
        updatePendingTransactions();
        
        users.forEach(user => {
          if (user.socket.readyState === WebSocket.OPEN) {
            user.socket.send(JSON.stringify({
              type: 'BALANCE_UPDATE',
              balance: calculateBalance(user.id)
            }));
          }
        });
        console.log(`New block mined by ${message.userId}, index: ${newBlock.index}`);
        break;
        
      default:
        console.log('Unknown message type:', message.type);
    }
  });
  
  // Event handler untuk penutupan koneksi
  socket.on('close', () => {
    // Hapus pengguna dari daftar
    const userIndex = users.findIndex(user => user.id === socket.userId);
    // if (userIndex !== -1) {
    //   const userId = users[userIndex].id;
    //   // users.splice(userIndex, 1);
      
    //   // Perbarui daftar pengguna
    //   updateUsers();
    //   console.log(`User ${userId} disconnected`);
    // }
    // console.log(`User joined: ${message.userId}`);
    console.log('Client disconnected');
  });
});



console.log('WebSocket server started on port 8081');