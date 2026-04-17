// --- 1. CONNECT TO SUPABASE ---
// Paste your Project URL and Anon Key right here inside the quotes!
const SUPABASE_URL = 'https://dzucmyrmdmktboybdmzs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PN_bL0FWVjJLK-e8DF0WxA__hjy-qV6';

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
        await supabaseClient.from('messages').insert([{ sender: myName, content: encrypted }]);
        input.value = '';
    }
});

fileInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const encryptedFileData = CryptoJS.AES.encrypt(event.target.result, getSecretKey()).toString();
            const blob = new Blob([encryptedFileData], { type: 'text/plain' });
            
            // Add the original file name to the text file name so we know what it was!
            const cleanFileName = file.name.replace(/[^a-zA-Z0-9.]/g, '_'); // Remove weird spaces/characters
            const fileName = Date.now() + '-' + cleanFileName + '.txt';

            const { error: uploadError } = await supabaseClient.storage.from('secure-files').upload(fileName, blob);
            if (uploadError) throw uploadError;

            const { data: urlData } = supabaseClient.storage.from('secure-files').getPublicUrl(fileName);

            // We now send the file name along with the URL so the receiver knows what to download it as
            const messageToEncrypt = "FILE::" + cleanFileName + "::" + urlData.publicUrl;
            const encryptedMessage = CryptoJS.AES.encrypt(messageToEncrypt, getSecretKey()).toString();

            await supabaseClient.from('messages').insert([{ sender: myName, content: encryptedMessage }]);

        } catch (err) {
            console.error("Upload failed:", err);
            alert("File upload failed.");
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
            if (content.startsWith('FILE::')) {
                // Split the string into our 3 parts: ["FILE", "myphoto.png", "https://..."]
                const parts = content.split('::');
                const originalFileName = parts[1];
                const fileUrl = parts[2];
                
                item.innerHTML = `<b>${msgObj.sender}:</b> <br> <span style="color:blue; font-size:12px;">Decrypting ${originalFileName}...</span>`;
                messages.appendChild(item);

                fetch(fileUrl)
                    .then(response => response.text())
                    .then(encryptedData => {
                        const decryptedBytes = CryptoJS.AES.decrypt(encryptedData, currentKey);
                        const fileData = decryptedBytes.toString(CryptoJS.enc.Utf8); // This is the Base64 data

                        // Determine how to display the file preview
                        let mediaPreview = '';
                        if (fileData.startsWith('data:image')) {
                            mediaPreview = `<img src="${fileData}" style="max-width:100%; border-radius:8px; margin-bottom:10px;">`;
                        } else if (fileData.startsWith('data:video')) {
                            mediaPreview = `<video src="${fileData}" controls style="max-width:100%; border-radius:8px; margin-bottom:10px;"></video>`;
                        } else {
                            mediaPreview = `<div style="padding:15px; background:#f0f2f5; border-radius:8px; margin-bottom:10px; text-align:center;">📄 Document</div>`;
                        }

                        // Build the final chat bubble with the Universal Download Button
                        item.innerHTML = `
                            <b>${msgObj.sender}:</b><br>
                            ${mediaPreview}<br>
                            <a href="${fileData}" download="decrypted_${originalFileName}" 
                               style="display:inline-block; padding:8px 15px; background:#0084ff; color:white; text-decoration:none; border-radius:5px; font-size:14px; text-align:center;">
                               ⬇ Download File
                            </a>
                        `;
                        messages.scrollTop = messages.scrollHeight; 
                    })
                    .catch(() => {
                        item.innerHTML = `<b>${msgObj.sender}:</b> [Failed to load file]`;
                    });

                return; 
            } else {
                item.innerHTML = `<b>${msgObj.sender}:</b> ${content}`;
            }
        } else {
            item.innerHTML = `<b>${msgObj.sender}:</b> <span style="color: #999; font-style: italic;">${content}</span>`;
            item.style.backgroundColor = "#f9f9f9"; 
        }
        
        messages.appendChild(item);
    });
    messages.scrollTop = messages.scrollHeight; 
}

keyInput.addEventListener('input', renderMessages);

// --- 5. RECEIVING DATA ---
async function loadHistory() {
    const { data } = await supabaseClient.from('messages').select('*').order('created_at', { ascending: true });
    if (data) {
        globalMessageStore = data;
        renderMessages();
    }
}

supabaseClient
  .channel('public:messages')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      globalMessageStore.push(payload.new);
      renderMessages();
  })
  .subscribe();

loadHistory();
