// --- 1. CONNECT TO SUPABASE ---
// Paste your Project URL and Anon Key right here inside the quotes!
const SUPABASE_URL = 'https://dzucmyrmdmktboybdmzs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PN_bL0FWVjJLK-e8DF0WxA__hjy-qV6';

// FIXED: We renamed this variable to 'supabaseClient' so it doesn't crash!
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- 2. SETUP USER NAME ---
let myName = localStorage.getItem('chat_username') || prompt("What is your name?");
localStorage.setItem('chat_username', myName);
document.getElementById('display-name').textContent = "User: " + myName;

const form = document.getElementById('form');
const input = document.getElementById('input');
const fileInput = document.getElementById('file-input');
const keyInput = document.getElementById('secret-key');
const messages = document.getElementById('messages');

let globalMessageStore = [];

function getSecretKey() {
    return keyInput.value || "default-public-key"; 
}

// --- 3. SENDING DATA (To Supabase) ---
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (input.value) {
        const encrypted = CryptoJS.AES.encrypt(input.value, getSecretKey()).toString();
        
        // FIXED: Using supabaseClient
        await supabaseClient.from('messages').insert([
            { sender: myName, content: encrypted }
        ]);
        
        input.value = '';
    }
});

// --- UPLOADING ENCRYPTED FILES TO A BUCKET ---
fileInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            // 1. Encrypt the file data
            const encryptedFileData = CryptoJS.AES.encrypt(event.target.result, getSecretKey()).toString();

            // 2. Turn that massive encrypted text into a Blob (a temporary file in the browser)
            const blob = new Blob([encryptedFileData], { type: 'text/plain' });
            
            // Generate a random file name so they don't overwrite each other
            const fileName = Date.now() + '-' + Math.floor(Math.random() * 1000) + '.txt';

            // 3. Upload the encrypted text file to Supabase Storage
            const { error: uploadError } = await supabaseClient.storage.from('secure-files').upload(fileName, blob);
            if (uploadError) throw uploadError;

            // 4. Get the public URL of that text file
            const { data: urlData } = supabaseClient.storage.from('secure-files').getPublicUrl(fileName);

            // 5. Send a chat message with a special "FILE::" tag and the URL
            const messageToEncrypt = "FILE::" + urlData.publicUrl;
            const encryptedMessage = CryptoJS.AES.encrypt(messageToEncrypt, getSecretKey()).toString();

            await supabaseClient.from('messages').insert([
                { sender: myName, content: encryptedMessage }
            ]);

        } catch (err) {
            console.error("Upload failed:", err);
            alert("File upload failed. Did you create the 'secure-files' bucket in Supabase?");
        }
    };
    reader.readAsDataURL(file); 
    fileInput.value = ''; 
});

// --- 4. THE RE-PAINTER ---
function renderMessages() {
    messages.innerHTML = ''; 
    const currentKey = getSecretKey();

    globalMessageStore.forEach(msgObj => {
        const item = document.createElement('li');
        let content = "";
        let isDecrypted = false;

        try {
            const bytes = CryptoJS.AES.decrypt(msgObj.content, currentKey);
            content = bytes.toString(CryptoJS.enc.Utf8);
            if (content && content.length > 0) { isDecrypted = true; } 
            else { throw new Error(); }
        } catch (e) {
            content = "🔒 [Encrypted - Different Key]"; 
        }

        if (isDecrypted) {
            // Check if the decrypted message is actually a hidden file link!
            if (content.startsWith('FILE::')) {
                const fileUrl = content.replace('FILE::', '');
                
                // Show a loading state first
                item.innerHTML = `<b>${msgObj.sender}:</b> <br> <span style="color:blue;">Loading encrypted file...</span>`;
                messages.appendChild(item);

                // Fetch the encrypted text file from the bucket
                fetch(fileUrl)
                    .then(response => response.text())
                    .then(encryptedData => {
                        // Decrypt the text back into the image/video
                        const decryptedBytes = CryptoJS.AES.decrypt(encryptedData, currentKey);
                        const fileData = decryptedBytes.toString(CryptoJS.enc.Utf8);

                        // Draw it on the screen
                        if (fileData.startsWith('data:image')) {
                            item.innerHTML = `<b>${msgObj.sender}:</b><br><img src="${fileData}" style="max-width:200px; border-radius:8px;">`;
                        } else if (fileData.startsWith('data:video')) {
                            item.innerHTML = `<b>${msgObj.sender}:</b><br><video src="${fileData}" controls style="max-width:250px; border-radius:8px;"></video>`;
                        } else {
                            item.innerHTML = `<b>${msgObj.sender}:</b> [Encrypted File]`;
                        }
                        messages.scrollTop = messages.scrollHeight; 
                    })
                    .catch(() => {
                        item.innerHTML = `<b>${msgObj.sender}:</b> [Failed to load file]`;
                    });

                return; // Stop here so we don't accidentally run the text append below
            } else {
                // It's just a normal text message
                item.innerHTML = `<b>${msgObj.sender}:</b> ${content}`;
            }
        } else {
            // Wrong Key
            item.innerHTML = `<b>${msgObj.sender}:</b> <span style="color: #999; font-style: italic;">${content}</span>`;
            item.style.backgroundColor = "#f9f9f9"; 
        }
        
        messages.appendChild(item);
    });
    messages.scrollTop = messages.scrollHeight; 
}

keyInput.addEventListener('input', renderMessages);

// --- 5. RECEIVING DATA (From Supabase) ---

// A. Fetch History when the app first loads
async function loadHistory() {
    // FIXED: Using supabaseClient
    const { data } = await supabaseClient.from('messages').select('*').order('created_at', { ascending: true });
    if (data) {
        globalMessageStore = data;
        renderMessages();
    }
}

// B. Listen for new messages in Real-Time
// FIXED: Using supabaseClient
supabaseClient
  .channel('public:messages')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      globalMessageStore.push(payload.new);
      renderMessages();
  })
  .subscribe();

// Start the app!
loadHistory();