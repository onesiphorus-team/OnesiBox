const clockElement = document.getElementById('clock');
const dateElement = document.getElementById('date');
const connectionIndicator = document.getElementById('connectionIndicator');
const statusText = document.getElementById('statusText');

const STATUS_MESSAGES = {
  connected: 'Connesso',
  reconnecting: 'Connessione in corso...',
  offline: 'Non connesso'
};

function updateClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  clockElement.textContent = `${hours}:${minutes}`;
}

function updateDate() {
  const now = new Date();
  const options = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  };
  dateElement.textContent = now.toLocaleDateString('it-IT', options);
}

function setConnectionStatus(status) {
  connectionIndicator.className = 'connection-indicator';
  connectionIndicator.classList.add(status);
  statusText.textContent = STATUS_MESSAGES[status] || status;
}

function checkServerStatus() {
  fetch('/api/status')
    .then(response => {
      if (response.ok) {
        return response.json();
      }
      throw new Error('Server not responding');
    })
    .then(data => {
      setConnectionStatus(data.connectionStatus || 'connected');
    })
    .catch(() => {
      setConnectionStatus('reconnecting');
    });
}

updateClock();
updateDate();

setInterval(updateClock, 1000);
setInterval(updateDate, 60000);
setInterval(checkServerStatus, 5000);

checkServerStatus();
