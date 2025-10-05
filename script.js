// --- IMPORTACIONES DE FIREBASE (SINTAXIS MODULAR V9+) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, onSnapshot, updateDoc, writeBatch, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- CONFIGURACIÓN Y VARIABLES GLOBALES ---
const ADMIN_UID = "M7XQCdDEV9dA4HVgP8GDoQ3T8z13";
const COOLDOWN_MINUTES = 15;
const BAN_BASE_MINUTES = 10;

const firebaseConfig = {
    apiKey: "AIzaSyAXlpmbW8rrUp1syiFBDsNvomDdXdThtNo",
    authDomain: "fuelgo-app.firebaseapp.com",
    projectId: "fuelgo-app",
    storageBucket: "fuelgo-app.appspot.com",
    messagingSenderId: "394707233601",
    appId: "1:394707233601:web:c3486f8dab5b0c66580fc0"
};

// Variables de estado de la aplicación
let db, auth;
let currentUID = null;
let stationIdToReport = null;
let deferredPrompt;
let adminClickCount = 0;
let adminClickTimer = null;
let adminSettings = { bannedUsers: [] };
let banCountdownInterval = null;
let stationTimers = {}; // Objeto para manejar los intervalos de cada estación

// Eliminar usuario online al cerrar la web
window.addEventListener('beforeunload', async function () {
    if (currentUID) {
        try {
            const { deleteDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            await deleteDoc(doc(db, "onlineUsers", currentUID));
        } catch (e) {
            // Puede fallar si el usuario ya se desconectó
        }
    }
});

// --- INICIALIZACIÓN DE LA APLICACIÓN ---
try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    
    setupEventListeners();
    setupTheme(); // Carga el tema al iniciar
    setupAuthentication();
    

    
} catch (error) {
    console.error("Error fatal inicializando Firebase:", error);
    document.getElementById('station-list').innerHTML = '<p class="initial-message">Error crítico al conectar con los servicios. Por favor, recarga la página.</p>';
}


// --- LÓGICA DE AUTENTICACIÓN ---
function setupAuthentication() {
    onAuthStateChanged(auth, async user => {
        currentUID = user ? user.uid : null;
        const userShortId = user ? user.uid.substring(0, 8) : "Anónimo";
        document.getElementById('menu-user-id').textContent = userShortId;
        if (user && user.uid === ADMIN_UID) {
            document.body.classList.add('is-admin');
        } else {
            document.body.classList.remove('is-admin');
        }
        document.body.classList.remove('is-authenticating');
        listenToSettings();
        listenToStations();

        // --- REGISTRO DE USUARIO ONLINE ---
        if (user) {
            try {
                await setDoc(doc(collection(db, "onlineUsers"), user.uid), {
                    uid: user.uid,
                    timestamp: Date.now()
                });
            } catch (e) {
                console.error("Error registrando usuario online:", e);
            }
        }
    });

    signInAnonymously(auth).catch(error => {
        console.error("Error de inicio de sesión anónimo:", error);
    });
}

// --- LÓGICA DE EVENTOS ---
function setupEventListeners() {
    document.getElementById('station-list').addEventListener('click', e => {
        const reportButton = e.target.closest('.report-button');
        if (reportButton) {
            stationIdToReport = reportButton.dataset.stationId;
            document.getElementById('confirmation-modal').classList.add('show-modal');
        }
    });
    
    document.getElementById('station-list').addEventListener('change', handleStatusChange);

    document.getElementById('confirm-report-btn').addEventListener('click', confirmReport);
    document.getElementById('cancel-report-btn').addEventListener('click', closeConfirmationModal);
    document.getElementById('confirmation-modal').addEventListener('click', e => { 
        if (e.target === e.currentTarget) closeConfirmationModal(); 
    });

    document.getElementById('app-title').addEventListener('click', handleAdminAccess);

    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const menuCloseBtn = document.getElementById('menu-close-btn');
    const menuOverlay = document.getElementById('side-menu-overlay');

    const openMenu = () => document.body.classList.add('menu-is-open');
    const closeMenu = () => document.body.classList.remove('menu-is-open');

    menuToggleBtn.addEventListener('click', openMenu);
    menuCloseBtn.addEventListener('click', closeMenu);
    menuOverlay.addEventListener('click', closeMenu);

    setupAdminEventListeners();

    // --- CONTADOR DE USUARIOS ONLINE EN TIEMPO REAL ---
    const onlineUsersCountSpan = document.getElementById('online-users-count');
    if (onlineUsersCountSpan) {
        onSnapshot(collection(db, 'onlineUsers'), (snapshot) => {
            onlineUsersCountSpan.textContent = snapshot.size;
        });
    }

    // --- ÚLTIMAS 6 ESTACIONES ACTUALIZADAS EN TIEMPO REAL ---
    const latestStationsList = document.getElementById('latest-stations-list');
    let latestStationsUnsub = null;
    function updateLatestStationsList() {
        getDocs(collection(db, 'stations')).then(snapshot => {
            const stations = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(st => st.lastUpdated)
                .sort((a, b) => {
                    const dateA = new Date(a.lastUpdated);
                    const dateB = new Date(b.lastUpdated);
                    return dateB - dateA;
                })
                .slice(0, 6);
            latestStationsList.innerHTML = stations.length === 0
                ? '<li>No hay reportes recientes.</li>'
                : stations.map(st => `<li><strong>${st.name}</strong> <br><span style="font-size:0.95em;">${st.lastUpdated} por <b>${st.reportedBy || 'N/A'}</b></span></li>`).join('');
            // Mostrar aviso de actualización
            showLatestStationsUpdatedNotice();
        });
    }

    function showLatestStationsUpdatedNotice() {
        let notice = document.getElementById('latest-stations-updated-notice');
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'latest-stations-updated-notice';
            notice.textContent = '¡Lista actualizada!';
            notice.style.cssText = 'background:var(--primary-color, #007bff);color:#fff;padding:6px 16px;border-radius:6px;position:fixed;bottom:80px;right:24px;z-index:9999;font-weight:bold;box-shadow:0 2px 8px rgba(0,0,0,0.12);';
            document.body.appendChild(notice);
        }
        notice.style.display = 'block';
        setTimeout(() => {
            notice.style.display = 'none';
        }, 1800);
    }
    if (latestStationsList) {
        // Actualización automática en tiempo real
        latestStationsUnsub = onSnapshot(collection(db, 'stations'), (snapshot) => {
            const stations = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(st => st.lastUpdated)
                .sort((a, b) => {
                    const dateA = new Date(a.lastUpdated);
                    const dateB = new Date(b.lastUpdated);
                    return dateB - dateA;
                })
                .slice(0, 6);
            latestStationsList.innerHTML = stations.length === 0
                ? '<li>No hay reportes recientes.</li>'
                : stations.map(st => `<li><strong>${st.name}</strong> <br><span style="font-size:0.95em;">${st.lastUpdated} por <b>${st.reportedBy || 'N/A'}</b></span></li>`).join('');
        });
        // Botón de actualización manual
        const refreshBtn = document.getElementById('refresh-latest-stations');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', updateLatestStationsList);
        }
    }


    // Detectar soporte de beforeinstallprompt
    let installBtn = document.getElementById('install-btn');
    let manualMsg = document.getElementById('manual-install-msg');
    let isChromium = /Chrome|Edg|OPR|Brave/i.test(navigator.userAgent) && !/Firefox|FxiOS/i.test(navigator.userAgent);
    let isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // Función para mostrar/ocultar el botón y mensaje según el dispositivo
    function updateInstallVisibility() {
        const isMobileNow = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.innerWidth <= 900 && window.innerHeight <= 900);
        if (!isMobileNow) {
            if (installBtn) installBtn.hidden = true;
            if (manualMsg) manualMsg.style.display = 'none';
        }
    }
    updateInstallVisibility();
    window.addEventListener('resize', updateInstallVisibility);

    let beforeInstallPromptFired = false;
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredPrompt = e;
        if (installBtn) installBtn.hidden = false;
        if (manualMsg) manualMsg.style.display = 'none';
        beforeInstallPromptFired = true;
    });

    if (installBtn) {
        installBtn.addEventListener('click', () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                installBtn.hidden = true;
            }
        });
    }

    // Si no se dispara beforeinstallprompt y es móvil, mostrar mensaje manual
    setTimeout(() => {
        if (!beforeInstallPromptFired && isMobile) {
            installBtn.hidden = true;
            manualMsg.style.display = 'block';
        }
    }, 1200);

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS && !navigator.standalone) {
        document.getElementById('ios-install-banner').hidden = false;
    }
    document.getElementById('ios-install-close-btn').addEventListener('click', () => {
        document.getElementById('ios-install-banner').hidden = true;
    });

    document.getElementById('station-search').addEventListener('input', function (event) {
        const searchTerm = event.target.value.toLowerCase();
        const stationList = document.getElementById('station-list');

        // Filtrar estaciones
        const stations = stationList.querySelectorAll('.station-item'); // Asumiendo que las estaciones tienen esta clase
        stations.forEach(station => {
            const stationName = station.textContent.toLowerCase();
            if (stationName.includes(searchTerm)) {
                station.style.display = 'block';
            } else {
                station.style.display = 'none';
            }
        });

        // Ocultar completamente los títulos de las categorías
        const categoryTitles = stationList.querySelectorAll('.category-title'); // Asumiendo que los títulos tienen esta clase
        categoryTitles.forEach(title => {
            title.style.display = 'none';
        });

        // Si no hay coincidencias, mostrar un mensaje de "No se encontraron resultados"
        const visibleStations = Array.from(stations).filter(station => station.style.display === 'block');
        if (visibleStations.length === 0) {
            stationList.innerHTML = '<p>No se encontraron resultados.</p>';
        }
    });
}

function setupAdminEventListeners() {

    // Definir primero los elementos
    const batchText = document.getElementById('batch-report-text');
    const batchCleanBtn = document.getElementById('batch-clean-btn');
    const batchBtn = document.getElementById('batch-report-btn');
    // Botón para limpiar caracteres * y _
    if (batchCleanBtn && batchText) {
        batchCleanBtn.addEventListener('click', () => {
            batchText.value = batchText.value.replace(/[\*_]/g, '');
        });
    }
    // Reporte en lote
    if (batchBtn && batchText) {
        batchBtn.addEventListener('click', async () => {
            let text = batchText.value;
            if (!text.trim()) return alert('Pega el mensaje de actualización.');
            // Eliminar * y _ de todo el texto
            text = text.replace(/[\*_]/g, '');
            // Extraer hora (formato flexible)
            const horaMatch = text.match(/(\d{1,2}:\d{2}\s*[ap]\.?m\.?)/i);
            let hora = null;
            if (horaMatch) {
                hora = horaMatch[1]
                    .replace(/\s+/g, ' ')
                    .replace(/\./g, '')
                    .replace('a m', 'AM').replace('p m', 'PM')
                    .replace('am', 'AM').replace('pm', 'PM')
                    .toUpperCase();
            }
            // Extraer estaciones y estados
            const lines = text.split('\n');
            const updates = [];
            lines.forEach(line => {
                // Extraer nombre de estación entre el primer guion y el segundo guion, ignorando espacios y paréntesis
                const match = line.match(/-\s*([^\-]+?)\s*-/);
                let name = match ? match[1].replace(/\(.*\)/, '').trim() : null;
                if (!name) {
                    // Si no hay match, intentar extraer después del primer guion
                    const parts = line.split('-');
                    if (parts.length > 1) name = parts[1].replace(/\(.*\)/, '').trim();
                }
                if (!name) return;
                let status = 'no-info';
                const lowerLine = line.toLowerCase();
                if (lowerLine.includes('surtiendo')) status = 'supplying';
                else if (lowerLine.includes('cerrada')) status = 'closed';
                else if (lowerLine.includes('sin información') || lowerLine.includes('sin informacion')) status = 'no-info';
                updates.push({ name, status });
            });
            if (updates.length === 0) return alert('No se encontraron estaciones en el mensaje.');
            // Buscar estaciones en la base de datos y actualizar
            const stationsCollection = collection(db, "stations");
            const stationSnapshot = await getDocs(stationsCollection);
            const batch = writeBatch(db);
            let actualizados = 0;
            // Normalizar nombres para comparar sin espacios, mayúsculas ni caracteres especiales ni tildes
            function normalize(str) {
                return str
                    .toLowerCase()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
                    .replace(/[^a-z0-9]/gi, '');
            }
            stationSnapshot.forEach(docSnap => {
                const station = docSnap.data();
                const stationNorm = normalize(station.name);
                const addressNorm = normalize(station.address);
                // Buscar coincidencia por nombre, por nombre parcial, por dirección o por nombre ignorando palabras extra
                const update = updates.find(u => {
                    let updateNorm = normalize(u.name);
                    // Si el nombre de la estación contiene paréntesis, solo comparar la parte principal
                    if (updateNorm.includes('(')) updateNorm = updateNorm.split('(')[0];
                    let stationNormMain = stationNorm.includes('(') ? stationNorm.split('(')[0] : stationNorm;
                    // Coincidencia exacta, parcial, o por dirección
                    return (
                        stationNorm === updateNorm ||
                        stationNormMain === updateNorm ||
                        updateNorm === stationNormMain ||
                        stationNorm.includes(updateNorm) ||
                        updateNorm.includes(stationNorm) ||
                        addressNorm.includes(updateNorm) ||
                        updateNorm.includes(addressNorm) ||
                        stationNormMain.includes(updateNorm) ||
                        updateNorm.includes(stationNormMain)
                    );
                });
                if (update) {
                    batch.update(docSnap.ref, {
                        status: update.status,
                        lastUpdated: hora || new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true }),
                        reportedBy: 'ADMIN'
                    });
                    actualizados++;
                }
            });
            if (actualizados === 0) return alert('No se encontraron coincidencias de estaciones para actualizar.');
            await batch.commit();
            alert(`Reportes actualizados para ${actualizados} estaciones.`);
        });
    }
    document.getElementById('admin-login-form').addEventListener('submit', handleAdminLogin);
    document.getElementById('admin-login-cancel').addEventListener('click', () => document.getElementById('admin-login-modal').classList.remove('show-modal'));
    // Mostrar/ocultar contraseña con texto
    const passwordInput = document.getElementById('admin-password');
    const toggleText = document.getElementById('toggle-password-text');
    if (toggleText && passwordInput) {
        toggleText.addEventListener('click', (e) => {
            e.preventDefault();
            const isVisible = passwordInput.type === 'text';
            passwordInput.type = isVisible ? 'password' : 'text';
            toggleText.textContent = isVisible ? 'Mostrar contraseña' : 'Ocultar contraseña';
        });
    }
    document.getElementById('admin-logout-btn').addEventListener('click', () => {
        signOut(auth).then(() => {
            alert('Sesión de administrador cerrada con éxito.');
            document.body.classList.remove('admin-view');
        });
    });

    document.getElementById('delete-report-btn').addEventListener('click', deleteStationReport);
    document.getElementById('ban-user-btn').addEventListener('click', banUser);
    document.getElementById('banned-users-list').addEventListener('click', e => {
        if (e.target.classList.contains('unban-btn')) unbanUser(e.target.dataset.userId);
    });
    document.getElementById('init-db-btn').addEventListener('click', initializeDatabase);
    document.getElementById('admin-return-btn').addEventListener('click', () => {
        document.body.classList.remove('admin-view');
    });
}

// --- LÓGICA DE TEMA OSCURO/CLARO ---
function setupTheme() {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const sunIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
    const moonIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

    const applyTheme = (theme) => {
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
            themeToggleBtn.innerHTML = sunIcon;
        } else {
            document.body.classList.remove('dark-theme');
            themeToggleBtn.innerHTML = moonIcon;
        }
    };

    const toggleTheme = () => {
        const currentTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
        localStorage.setItem('theme', currentTheme);
        applyTheme(currentTheme);
    };

    themeToggleBtn.addEventListener('click', toggleTheme);
    
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
}

function handleStatusChange(event) {
    if (!event.target.id.startsWith('status-select-')) {
        return;
    }
    const stationId = event.target.id.split('-')[2];
    const flowSelect = document.getElementById(`flow-select-${stationId}`);
    if (!flowSelect) return;

    // Solo habilitar si el estado es 'supplying'
    if (event.target.value === 'supplying') {
        flowSelect.disabled = false;
    } else {
        flowSelect.disabled = true;
    }
}

// --- LÓGICA DE FIREBASE (LECTURA) ---
function listenToStations() {
    const stationsCollection = collection(db, "stations");
    onSnapshot(stationsCollection, (snapshot) => {
        const stations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderStations(stations);
        populateAdminStationSelects(stations);
        populateAdminUserSelect(stations);
    }, console.error);
}

function listenToSettings() {
    const settingsDoc = doc(db, "admin", "settings");
    onSnapshot(settingsDoc, (doc) => {
        if (doc.exists()) adminSettings = doc.data();
        updateUIAccordingToSettings();
        if (currentUID) {
            checkUserBanStatus(currentUID.substring(0, 8));
        }
    }, console.error);
}

// --- RENDERIZADO DE LA INTERFAZ ---
function renderStations(stations) {
    const stationList = document.getElementById('station-list');
    if (stations.length === 0) {
        stationList.innerHTML = `<p class="initial-message">No hay estaciones. El admin debe inicializar la base de datos.</p>`;
        return;
    }
    
    // Orden personalizado de sectores y estaciones
    const sectorOrder = [
        {
            name: "Sector Centro",
            stations: [
                "Bolívar",
                "Juncal",
                "Filipetti",
                "Nueva Avenida",
                "González"
            ]
        },
        {
            name: "Av Ugarte Pelayo",
            stations: [
                "Monagas",
                "Vespa",
                "Manantial",
                "Escorpio",
                "Parador"
            ]
        },
        {
            name: "Av Bella Vista (Vía  Zona Industrial)",
            stations: [
                "A.K.A",
                "Dannelys",
                "Guarapiche II"
            ]
        },
        {
            name: "Via el Sur",
            stations: [
                "Guarapiche I (El Lechón)",
                "MOR (El Silencio)",
                "La Jaiba (Temblador)"
            ]
        },
        {
            name: "Vía Caripe",
            stations: [
                "Costa Azul (Toscana)"
            ]
        }
    ];
    // Agrupar estaciones por sector
    const stationsBySector = {};
    stations.forEach(station => {
        // Normalizar nombre de sector para emparejar
        let sector = station.sector || "General";
        // Emparejar sector con el orden personalizado
        const foundSector = sectorOrder.find(s => s.name.toLowerCase() === sector.toLowerCase());
        if (foundSector) {
            if (!stationsBySector[foundSector.name]) stationsBySector[foundSector.name] = [];
            stationsBySector[foundSector.name].push(station);
        }
    });
    let content = '';
    const searchValue = (document.getElementById('station-search')?.value || '').toLowerCase();
    sectorOrder.forEach((sectorObj, idx) => {
        const sectorStations = stationsBySector[sectorObj.name] || [];
        // Filtrar y ordenar según el orden dado
        const filteredStations = sectorObj.stations
            .map(stName => sectorStations.find(s => s.name.toLowerCase() === stName.toLowerCase()))
            .filter(Boolean)
            .filter(station =>
                station.name.toLowerCase().includes(searchValue) ||
                station.address.toLowerCase().includes(searchValue)
            );
        if (filteredStations.length === 0) return;
        const sectorId = `sector-accordion-${sectorObj.name.replace(/\s/g, '-')}`;
        const isOpen = idx === 0;
        content += `
        <div class="sector-accordion">
            <button class="sector-accordion-header${isOpen ? ' open' : ''}" data-sector="${sectorId}" aria-expanded="${isOpen}">
                ${sectorObj.name}
                <span class="accordion-arrow">${isOpen ? '&#9650;' : '&#9660;'}</span>
            </button>
            <div class="sector-accordion-content" id="${sectorId}" style="display:${isOpen ? 'block' : 'none'};">
                ${filteredStations.map(station => generateStationCardHTML(station)).join('')}
            </div>
        </div>
        `;
    });
    stationList.innerHTML = content;
    // Eventos acordeón
    document.querySelectorAll('.sector-accordion-header').forEach(btn => {
        btn.addEventListener('click', function() {
            const sectorId = this.dataset.sector;
            const contentDiv = document.getElementById(sectorId);
            const isOpen = contentDiv.style.display === 'block';
            contentDiv.style.display = isOpen ? 'none' : 'block';
            this.classList.toggle('open', !isOpen);
            this.setAttribute('aria-expanded', !isOpen);
            this.querySelector('.accordion-arrow').innerHTML = !isOpen ? '&#9650;' : '&#9660;';
        });
    });
    updateAllCooldowns(stations);

    // Evento de búsqueda (solo se agrega una vez)
    const searchInput = document.getElementById('station-search');
    if (searchInput && !searchInput.dataset.listener) {
        searchInput.addEventListener('input', () => renderStations(stations));
        searchInput.dataset.listener = 'true';
    }
}

function generateStationCardHTML(station) {
    const { id, name, address, status, flow, lastUpdated, reportedBy } = station;
    // Badge de estado con color y tema
    let statusBadge = '<div class="report-badge no-info">Sin Información</div>';
    if (status === 'supplying') statusBadge = '<div class="report-badge supplying">Surtiendo</div>';
    else if (status === 'closed') statusBadge = '<div class="report-badge closed">Cerrada</div>';
    else if (status === 'downloading') statusBadge = '<div class="report-badge downloading">Descargando 🚚</div>';
    else if (status === 'ultimo-marcado') statusBadge = '<div class="report-badge ultimo-marcado">Ultimo Marcado ⚠️</div>';
    let flowBadge = (status === 'supplying' && flow) ? `<div class="report-badge flow-${flow.toLowerCase()}">Fluidez: ${flow}</div>` : '';
    let timeHTML = lastUpdated ? `<p class="timestamp">Última act.: ${lastUpdated} <span class="reporter-id">por ${reportedBy}</span></p>` : '';
    return `<li id="station-${id}" class="station-card station-item">
        <div class="station-info">
            <h2>${name}</h2>
            <p>${address}</p>
            ${timeHTML}
        </div>
        <div class="report-status">${statusBadge}${flowBadge}</div>
        <div class="report-section" id="report-section-${id}">
            ${getReportControlsHTML(id)}
        </div>
    </li>`;
}


function updateUIAccordingToSettings() {
    if (document.body.classList.contains('is-admin')) {
        populateBannedUsersList();
    }
    updateAllCooldowns(getAllStationsFromDOM());
}

// --- LÓGICA DE REPORTES Y COOLDOWN ---
async function confirmReport() {
    if (!stationIdToReport || !currentUID) return;
    const userShortId = currentUID.substring(0, 8);
    
    if (adminSettings.bannedUsers?.some(user => user.id === userShortId)) {
        alert("Tu cuenta está bloqueada y no puedes realizar reportes.");
        return closeConfirmationModal();
    }

    const endTime = localStorage.getItem(`fuelgo_cooldown_${stationIdToReport}`);
    if (endTime && Date.now() < endTime && currentUID !== ADMIN_UID) {
        alert("Debes esperar antes de poder reportar en esta estación de nuevo.");
        return closeConfirmationModal();
    }
    
    const statusSelect = document.getElementById(`status-select-${stationIdToReport}`);
    const flowSelect = document.getElementById(`flow-select-${stationIdToReport}`);
    const statusValue = statusSelect.value;
    
    const reportData = {
        status: statusValue,
        flow: statusValue === 'supplying' ? flowSelect.value : null,
        lastUpdated: new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true }),
        reportedBy: userShortId
    };
    
    const stationDoc = doc(db, "stations", stationIdToReport.toString());
    await updateDoc(stationDoc, reportData);
    
    if (currentUID !== ADMIN_UID) {
        const newEndTime = Date.now() + COOLDOWN_MINUTES * 60 * 1000;
        localStorage.setItem(`fuelgo_cooldown_${stationIdToReport}`, newEndTime);
    }
    
    updateAllCooldowns(getAllStationsFromDOM());
    closeConfirmationModal();
}

function closeConfirmationModal() {
    document.getElementById('confirmation-modal').classList.remove('show-modal');
    stationIdToReport = null;
}

function getReportControlsHTML(stationId) {
    return `<div class="report-controls">
                <select id="status-select-${stationId}" aria-label="Estado">
                    <option value="supplying">Surtiendo</option>
                    <option value="closed">Cerrada</option>
                    <option value="downloading">Descargando</option>
                    <option value="ultimo-marcado">Ultimo Marcado</option>
                    <option value="no-info">Sin Información</option>
                </select>
                <select id="flow-select-${stationId}" aria-label="Fluidez">
                    <option value="Ligera">Ligera</option>
                    <option value="Moderada">Moderada</option>
                    <option value="Congestionada">Congestionada</option>
                </select>
            </div>
            <button class="report-button" data-station-id="${stationId}">Reportar</button>`;
}


function updateCooldown(stationId) {
    const section = document.getElementById(`report-section-${stationId}`);
    if (!section) return;

    clearInterval(stationTimers[stationId]);

    const endTime = localStorage.getItem(`fuelgo_cooldown_${stationId}`);
    const isCoolingDown = endTime && Date.now() < endTime && currentUID !== ADMIN_UID;

    if (isCoolingDown) {
        section.innerHTML = `<p class="cooldown-timer">Próximo reporte en: <span id="timer-${stationId}">--:--</span></p>`;
        section.classList.add('disabled');

        const updateTimer = () => {
            const remaining = endTime - Date.now();
            if (remaining <= 0) {
                clearInterval(stationTimers[stationId]);
                localStorage.removeItem(`fuelgo_cooldown_${stationId}`);
                section.innerHTML = getReportControlsHTML(stationId);
                section.classList.remove('disabled');
            } else {
                const minutes = Math.floor(remaining / 60000).toString().padStart(2, '0');
                const seconds = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
                const timerSpan = document.getElementById(`timer-${stationId}`);
                if (timerSpan) timerSpan.textContent = `${minutes}:${seconds}`;
            }
        };
        updateTimer();
        stationTimers[stationId] = setInterval(updateTimer, 1000);

    } else {
        section.innerHTML = getReportControlsHTML(stationId);
        section.classList.remove('disabled');
    }
}

function updateAllCooldowns(stations) {
    stations.forEach(station => updateCooldown(station.id));
}

function getAllStationsFromDOM() {
    return Array.from(document.querySelectorAll('.station-card')).map(card => {
        const id = card.id.split('-')[1];
        return { id };
    }).filter(s => s.id);
}

// --- LÓGICA DE ADMINISTRADOR ---


function handleAdminAccess() {
    adminClickCount++;
    clearTimeout(adminClickTimer);
    adminClickTimer = setTimeout(() => { adminClickCount = 0; }, 1500);
    if (adminClickCount === 4) {
        adminClickCount = 0;
        if (currentUID === ADMIN_UID) {
            document.body.classList.toggle('admin-view');
        } else {
            document.getElementById('admin-login-modal').classList.add('show-modal');
        }
    }
}

function handleAdminLogin(e) {
    e.preventDefault();
    const email = document.getElementById('admin-email').value;
    const password = document.getElementById('admin-password').value;
    const errorP = document.getElementById('admin-login-error');
    errorP.hidden = true;

    signInWithEmailAndPassword(auth, email, password)
        .then(userCredential => {
            if (userCredential.user.uid === ADMIN_UID) {
                document.getElementById('admin-login-modal').classList.remove('show-modal');
                document.body.classList.add('admin-view');
            } else {
                errorP.textContent = "Este usuario no es un administrador.";
                errorP.hidden = false;
                signOut(auth).then(() => signInAnonymously(auth));
            }
        })
        .catch(error => {
            errorP.textContent = "Error: Credenciales incorrectas.";
            errorP.hidden = false;
        });
}

function populateAdminStationSelects(stations) {
    const deleteSelect = document.getElementById('delete-report-select');
    let options = '<option value="">Selecciona una estación...</option>';
    options += '<option value="all" style="font-weight: bold; color: var(--danger-color);">-- Borrar Todos los Reportes --</option>';
    stations.sort((a,b) => a.name.localeCompare(b.name)).forEach(s => {
        options += `<option value="${s.id}">${s.name}</option>`;
    });
    deleteSelect.innerHTML = options;
}

function populateAdminUserSelect(stations) {
    const banSelect = document.getElementById('ban-user-select');
    const reportedIds = new Set(stations.map(s => s.reportedBy).filter(Boolean));
    let options = '<option value="">O selecciona de la lista...</option>';
    [...reportedIds].sort().forEach(id => {
        options += `<option value="${id}">${id}</option>`;
    });
    banSelect.innerHTML = options;
}

function populateBannedUsersList() {
    const bannedList = document.getElementById('banned-users-list');
    if (!adminSettings.bannedUsers || adminSettings.bannedUsers.length === 0) {
        bannedList.innerHTML = '<li>No hay usuarios bloqueados.</li>';
        return;
    }
    bannedList.innerHTML = adminSettings.bannedUsers.sort((a, b) => a.id.localeCompare(b.id)).map(user => 
        `<li><span>${user.id} (Baneado ${user.count} ${user.count > 1 ? 'veces' : 'vez'})</span><button class="unban-btn admin-button" data-user-id="${user.id}">Desbloquear</button></li>`
    ).join('');
}



async function deleteStationReport() {
    const stationId = document.getElementById('delete-report-select').value;
    if (!stationId) return alert("Por favor, selecciona una estación.");
    
    const resetData = { status: null, flow: null, lastUpdated: null, reportedBy: null };

    if (stationId === "all") {
        if (confirm("¿ESTÁS SEGURO? Esto borrará TODOS los reportes de TODAS las estaciones.")) {
            const stationsCollection = collection(db, "stations");
            const stationSnapshot = await getDocs(stationsCollection);
            const batch = writeBatch(db);
            stationSnapshot.forEach(doc => {
                batch.update(doc.ref, resetData);
            });
            await batch.commit();
            alert("Todos los reportes han sido borrados.");
        }
    } else {
        if (confirm(`¿Estás seguro de borrar el reporte de esta estación?`)) {
            const stationDoc = doc(db, "stations", stationId);
            await updateDoc(stationDoc, resetData);
            alert("Reporte borrado.");
        }
    }
}

async function banUser() {
    const banInput = document.getElementById('ban-user-id');
    const userIdToBan = (banInput.value.trim() || document.getElementById('ban-user-select').value).substring(0, 8);
    if (!userIdToBan) return alert("Introduce o selecciona un ID de usuario.");

    const bannedUsers = adminSettings.bannedUsers || [];
    const userIndex = bannedUsers.findIndex(user => user.id === userIdToBan);

    if (userIndex > -1) {
        bannedUsers[userIndex].count++;
        bannedUsers[userIndex].bannedAt = Date.now();
    } else {
        bannedUsers.push({ id: userIdToBan, count: 1, bannedAt: Date.now() });
    }

    const settingsDoc = doc(db, "admin", "settings");
    await updateDoc(settingsDoc, { bannedUsers });
    alert(`Usuario ${userIdToBan} bloqueado.`);
    banInput.value = '';
}

async function unbanUser(userId) {
    if (!userId) return;
    const updatedBannedUsers = (adminSettings.bannedUsers || []).filter(user => user.id !== userId);
    const settingsDoc = doc(db, "admin", "settings");
    await updateDoc(settingsDoc, { bannedUsers: updatedBannedUsers });
}

function checkUserBanStatus(uhtkhnInterval) {
    const bannedUser = adminSettings.bannedUsers?.find(user => user.id === userShortId);

    if (bannedUser) {
        const banDurationMinutes = bannedUser.count * BAN_BASE_MINUTES;
        const expirationTime = bannedUser.bannedAt + banDurationMinutes * 60 * 1000;
        
        if (Date.now() < expirationTime) {
            const modal = document.getElementById('ban-modal');
            const countdownEl = document.getElementById('ban-countdown');
            document.body.classList.add('is-banned');
            modal.classList.add('show-modal');

            const updateCountdown = () => {
                const remaining = expirationTime - Date.now();
                if (remaining <= 0) {
                    clearInterval(banCountdownInterval);
                    modal.classList.remove('show-modal');
                    document.body.classList.remove('is-banned');
                    countdownEl.textContent = "00:00";
                    unbanUser(userShortId); 
                } else {
                    const minutes = Math.floor((remaining / 1000 / 60) % 60).toString().padStart(2, '0');
                    const seconds = Math.floor((remaining / 1000) % 60).toString().padStart(2, '0');
                    countdownEl.textContent = `${minutes}:${seconds}`;
                }
            };
            updateCountdown();
            banCountdownInterval = setInterval(updateCountdown, 1000);
        }
    } else {
        document.getElementById('ban-modal').classList.remove('show-modal');
        document.body.classList.remove('is-banned');
    }
}

async function initializeDatabase() {
    if (!confirm("¿SEGURO? Esto creará las colecciones iniciales. SOLO DEBE HACERSE UNA VEZ.")) return;
    
    const initialStations = [
        // Sector Centro
        { id: "1", name: "Bolívar", address: "Av. Bolívar con Raúl Leoni, Frente al parque La Guaricha.", sector: "Sector Centro" },
        { id: "2", name: "Juncal", address: "Entre la Av. Juncal y la Av. Orinoco.", sector: "Sector Centro" },
        { id: "3", name: "Filipetti", address: "Avenida Raúl Leoni, en la entrada de Las Cocuizas.", sector: "Sector Centro" },
        { id: "4", name: "Nueva Avenida", address: "Av. Bicentenario, después de la Plaza Piar, vía a Weeko.", sector: "Sector Centro" },
        { id: "5", name: "González", address: "Avenida Bella Vista, altura de La Muralla, cerca de la plaza El Indio.", sector: "Sector Centro" },
        // Av Ugarte Pelayo
        { id: "6", name: "Monagas", address: "Av. Alirio Ugarte Pelayo, frente al Hotel Jade.", sector: "Av Ugarte Pelayo" },
        { id: "7", name: "Vespa", address: "Av. Alirio Ugarte Pelayo, frente a la Clínica de Pdvsa.", sector: "Av Ugarte Pelayo" },
        { id: "8", name: "Manantial", address: "Av. Alirio Ugarte Pelayo, después de la Ford. (También conocida como La Cueva).", sector: "Av Ugarte Pelayo" },
        { id: "9", name: "Escorpio", address: "Av. Alirio Ugarte Pelayo, donde queda Papa John’s Pizza.", sector: "Av Ugarte Pelayo" },
        { id: "10", name: "Parador", address: "Av. Alirio Ugarte Palayo, en la Redoma El Gran Parador.", sector: "Av Ugarte Pelayo" },
        // Av Bella Vista (Vía  Zona Industrial)
        { id: "11", name: "A.K.A", address: "avenida Bella Vista, después del Hospital Metropolitano", sector: "Av Bella Vista (Vía  Zona Industrial)" },
        { id: "12", name: "Dannelys", address: "avenida Bella Vista, después de la AKA, sentido hacia La Cruz.", sector: "Av Bella Vista (Vía  Zona Industrial)" },
        { id: "13", name: "Guarapiche II", address: "avenida José Tadeo Monagas, Las Cocuizas.", sector: "Av Bella Vista (Vía  Zona Industrial)" },
        // Via el Sur
        { id: "14", name: "Guarapiche I (El Lechón)", address: "vía el Sur, sector Parare", sector: "Via el Sur" },
        { id: "15", name: "MOR (El Silencio)", address: "sin informacion", sector: "Via el Sur" },
        { id: "16", name: "La Jaiba (Temblador)", address: "sin informacion", sector: "Via el Sur" },
        // Vía Caripe
        { id: "17", name: "Costa Azul (Toscana)", address: "sin informacion", sector: "Vía Caripe" }
    ];

    try {
        const batch = writeBatch(db);
        initialStations.forEach(station => {
            const stationRef = doc(db, "stations", station.id);
            // Modelo de datos actualizado a 'status'
            batch.set(stationRef, { name: station.name, address: station.address, sector: station.sector, status: null, flow: null, lastUpdated: null, reportedBy: null });
        });
        const settingsRef = doc(db, "admin", "settings");
        batch.set(settingsRef, { reportsLocked: false, bannedUsers: [] });
        await batch.commit();
        alert("¡Base de datos inicializada exitosamente!");
    } catch (error) {
        console.error("Error al inicializar la base de datos:", error);
        alert("Error al inicializar la base de datos. Revisa la consola.");
    }
}