// DOM Elements
const clockElement = document.getElementById('clock');
const dateElement = document.getElementById('date');
const connectionIndicator = document.getElementById('connectionIndicator');
const statusText = document.getElementById('statusText');
const versionInfo = document.getElementById('versionInfo');
const ipInfo = document.getElementById('ipInfo');
const wifiInfo = document.getElementById('wifiInfo');
const particlesContainer = document.getElementById('particles');

const STATUS_MESSAGES = {
  connected: 'Connesso',
  reconnecting: 'Connessione in corso...',
  offline: 'Non connesso'
};

// Clock and Date
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

// Connection Status
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

// System Info
function updateSystemInfo() {
  fetch('/api/system-info')
    .then(response => {
      if (response.ok) {
        return response.json();
      }
      throw new Error('Cannot get system info');
    })
    .then(data => {
      if (data.version) {
        versionInfo.textContent = `OnesiBox v${data.version}`;
      }
      if (data.ip) {
        ipInfo.textContent = `IP: ${data.ip}`;
      }
      if (data.wifi) {
        wifiInfo.textContent = `WiFi: ${data.wifi}`;
      } else {
        wifiInfo.textContent = 'WiFi: Non connesso';
      }
    })
    .catch(() => {
      versionInfo.textContent = 'OnesiBox';
      ipInfo.textContent = 'IP: --';
      wifiInfo.textContent = 'WiFi: --';
    });
}

// Animated Particles
function createParticles() {
  const particleCount = 20;

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';

    // Random position
    particle.style.left = Math.random() * 100 + '%';

    // Random size
    const size = Math.random() * 4 + 2;
    particle.style.width = size + 'px';
    particle.style.height = size + 'px';

    // Random animation delay and duration
    particle.style.animationDelay = Math.random() * 15 + 's';
    particle.style.animationDuration = (Math.random() * 10 + 10) + 's';

    // Random opacity
    particle.style.opacity = Math.random() * 0.5 + 0.1;

    particlesContainer.appendChild(particle);
  }
}

// Initialize
function init() {
  updateClock();
  updateDate();
  createParticles();
  checkServerStatus();
  updateSystemInfo();

  // Update intervals
  setInterval(updateClock, 1000);
  setInterval(updateDate, 60000);
  setInterval(checkServerStatus, 5000);
  setInterval(updateSystemInfo, 30000); // Update system info every 30 seconds
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
