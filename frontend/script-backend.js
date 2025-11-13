// ==================== VARIAVEIS GLOBAIS / ESTADO ====================
const API_URL = 'https://teste1-zrvs.onrender.com';
let currentUser = localStorage.getItem('currentUser') || 'N/A';
let activities = [];
let executions = [];
let executingActivity = null;
const stopwatchIntervals = {};
let dueCheckerInterval = null;
let alertCheckerInterval = null;
let masterClockInterval = null;
let currentTaskToComplete = { taskId: null, success: null };
let currentReportInstanceId = null;
let notificationLog = JSON.parse(localStorage.getItem('notificationLog')) || [];
let isNotificationPanelOpen = false;
let parsedData = null;
let headerRow = null;


// ==================== PERSISTÊNCIA E INICIALIZAÇÃO ====================
/**
 * @description Carrega o estado inicial da aplicação vindo do Backend.
 */
async function loadState() {
    try {
        const resTurno = await fetch(`${API_URL}/api/turno-ativo`);
        if (!resTurno.ok) throw new Error(`Erro ao buscar turno: ${resTurno.statusText}`);
        const turnoAtivoDB = await resTurno.json();

        if (turnoAtivoDB) {
            executingActivity = {
                instanceId: turnoAtivoDB.instanceId,
                operator: turnoAtivoDB.operatorResponsavel,
                shiftStart: turnoAtivoDB.inicioTurno,
                shiftEnd: turnoAtivoDB.fimTurno,
                status: turnoAtivoDB.status,
                ditlTotalSeconds: turnoAtivoDB.ditlTotalSeconds,
                tasks: turnoAtivoDB.tasks.map(t => ({
                    ...t,
                    id: t.taskId,
                    'Proc. ID': t.procId,
                    'Event / Action': t.acao,
                    _stopwatchRunning: false,
                    _stopwatchStart: null,
                    _nextTaskAlertShown: false,
                    targetSeconds: t.targetSeconds || 0,
                    dueSeconds: t.targetSeconds || 0,
                    runtimeSeconds: t.runtimeSeconds || 0,
                    photos: t.photos || []
                }))
            };

            localStorage.setItem('shiftActiveISO', executingActivity.shiftStart);
            executingActivity.tasks.forEach(task => {
                if (task.status === 'em execução') {
                    startStopwatch(task.id);
                }
            });

            if (executingActivity.instanceId) {
                selectExecutionInstance(executingActivity.instanceId);
            }

            if (executingActivity.status === 'ativo') {
                const resAtividades = await fetch(`${API_URL}/api/atividades-importadas`);
                const atividadesModelo = await resAtividades.json();
                let maxSeconds = 0;
                atividadesModelo.forEach(t => {
                    const seconds = timeToTotalSeconds(t.tempoPrevisto);
                    if (seconds > maxSeconds) maxSeconds = seconds;
                });
                executingActivity.ditlTotalSeconds = maxSeconds;
                startMasterClock(maxSeconds);
            }

        } else {
            executingActivity = null;
            localStorage.removeItem('shiftActiveISO');
        }

        const resAtividades = await fetch(`${API_URL}/api/atividades-importadas`);
        if (!resAtividades.ok) throw new Error('Erro ao buscar atividades modelo');

        const atividadesDB = await resAtividades.json();
        activities = atividadesDB.map(act => ({
            'T + (hh:mm)': act.tempoPrevisto,
            'Proc. ID': act.procId,
            'Event': act.evento,
            'Event / Action': act.acao,
            'Key Acceptance Criteria': act.criteriosAceitacao
        }));

        if (activities.length > 0) {
            document.getElementById('loadedContainer').classList.remove('hidden');
        }

    } catch (error) {
        console.error("Falha fatal no loadState:", error);
        showNotification("ERRO: Não foi possível carregar dados do servidor.", 10000, 'critical');
    }
    renderHeaderStatus();
    renderExecutionInstances();
    updateStats();
    renderActivityPreview();
    renderNotificationLog();

    const activeTabId = localStorage.getItem('activeTabId') || 'cadastro';
    const activeTabButton = document.querySelector(`.tab-btn[onclick*='${activeTabId}']`);
    if (activeTabButton) {
        showTab(activeTabId, activeTabButton);
    } else {
        showTab('cadastro', document.querySelector(".tab-btn[onclick*='cadastro']"));
    }

    startScheduledChecker();
    startAlertChecker();
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('evidenceFileInput').addEventListener('change', addPhotosToEvidenceModal);
    loadState();
});

// ==================== UTILITY FUNCTIONS & NOTIFICATIONS ====================

function showNotification(message, duration = 3000, type = 'default') {
    notificationLog.unshift({
        timestamp: new Date().toISOString(),
        message: message,
        type: type,
        read: false
    });
    notificationLog = notificationLog.slice(0, 50);
    localStorage.setItem('notificationLog', JSON.stringify(notificationLog));
    renderNotificationLog();
    // ... (resto da função igual)
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    document.body.appendChild(el);
    el.textContent = message;
    setTimeout(() => {
        el.remove();
    }, duration);
}

function renderNotificationLog() {
    const logEl = document.getElementById('notificationLog');
    const countEl = document.getElementById('notificationCount');
    logEl.innerHTML = '';
    const unreadCount = notificationLog.filter(item => !item.read).length;
    if (unreadCount > 0) {
        countEl.textContent = unreadCount;
        countEl.style.display = 'flex';
    } else {
        countEl.textContent = 0;
        countEl.style.display = 'none';
    }
    if (notificationLog.length === 0) {
        logEl.innerHTML = `<div class="small" style="opacity: 0.7;">Nenhum alerta recente.</div>`;
        return;
    }
    notificationLog.forEach(item => {
        const time = new Date(item.timestamp).toLocaleTimeString();
        const typeClass = item.type === 'warning' ? 'warning' : item.type === 'critical' ? 'critical' : '';
        logEl.innerHTML += `
            <div class="alert-item ${typeClass}" style="${item.read ? 'opacity: 0.7; font-weight: 400;' : 'font-weight: 700;'}">
                <div class="small">${time} ${item.read ? '(Lido)' : ''}</div>
                <div class="small">${item.message}</div>
            </div>
        `;
    });
}

function toggleNotificationPanel() {
    const panel = document.getElementById('notificationPanel');
    isNotificationPanelOpen = !isNotificationPanelOpen;
    if (isNotificationPanelOpen) {
        panel.classList.add('open');
        notificationLog.forEach(item => item.read = true);
        localStorage.setItem('notificationLog', JSON.stringify(notificationLog));
        renderNotificationLog();
    } else {
        panel.classList.remove('open');
    }
}

function clearNotificationLog() {
    notificationLog = [];
    localStorage.setItem('notificationLog', JSON.stringify(notificationLog));
    renderNotificationLog();
    showNotification('Log de notificações limpo.', 2000);
}


function showTab(tabId, clickedButton) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    if (clickedButton) {
        clickedButton.classList.add('active');
        localStorage.setItem('activeTabId', tabId);
    } else {
        document.querySelector(`.tab-btn[onclick*='${tabId}']`)?.classList.add('active');
        localStorage.setItem('activeTabId', tabId);
    }
    if (tabId === 'execucao') {
        renderExecutionInstances();
        if (executingActivity) {
            selectExecutionInstance(executingActivity.instanceId);
        }
    } else if (tabId === 'relatorios') {
        renderAllReports();
    }
}

function escapeHtml(str) { return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

function formatSeconds(sec) {
    const totalSecs = Math.max(0, Math.floor(sec));
    const mm = Math.floor(totalSecs / 60);
    const ss = totalSecs % 60;
    const hh = Math.floor(mm / 60);
    const disp_mm = mm % 60;
    return `${String(hh).padStart(2, '0')}:${String(disp_mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function timeToSeconds(timeStr) {
    if (!timeStr) return null;
    const matches = timeStr.match(/(\d{2}):(\d{2})/g);
    if (!matches) return null;
    const lastTimeStr = matches[matches.length - 1];
    const parts = lastTimeStr.split(':').map(p => parseInt(p, 10));
    if (parts.length === 2) {
        const hours = parts[0];
        const minutes = parts[1];
        return (hours * 3600) + (minutes * 60);
    }
    return null;
}

function timeToTotalSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(p => parseInt(p, 10));
    if (parts.length === 2) {
        return (parts[0] * 3600) + (parts[1] * 60);
    }
    return 0;
}

function secondsToHHMM(totalSeconds) {
    const totalSecs = Math.max(0, Math.floor(totalSeconds));
    const mm = Math.floor(totalSecs / 60);
    const hh = Math.floor(mm / 60);
    const disp_mm = mm % 60;
    return `${String(hh).padStart(2, '0')}:${String(disp_mm).padStart(2, '0')}`;
}

function timeStrToFutureDate(timeStr) {
    const [hh, mm] = timeStr.split(':').map(p => parseInt(p, 10));
    const now = new Date();
    let targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
    if (targetDate.getTime() <= now.getTime()) {
        targetDate.setDate(targetDate.getDate() + 1);
    }
    return targetDate;
}

// ==================== CONTROLE DE USUÁRIO E TURNO ====================

function renderHeaderStatus() {
    const shiftActiveISO = localStorage.getItem('shiftActiveISO');
    const shiftStatusEl = document.getElementById('shiftStatus');
    const btnStart = document.getElementById('btnStartShift');
    const btnEnd = document.getElementById('btnEndShift');
    const btnRestart = document.getElementById('btnRestartShift');

    if (shiftActiveISO && executingActivity) {
        const operatorName = executingActivity.operator || 'N/A';
        shiftStatusEl.textContent = `Turno ATIVO desde: ${new Date(shiftActiveISO).toLocaleString()} (Operador: ${operatorName})`;
        btnStart.disabled = true;
        btnEnd.disabled = false;
        if (btnRestart) btnRestart.disabled = false;
    } else {
        shiftStatusEl.textContent = 'Turno encerrado ou não iniciado.';
        btnStart.disabled = activities.length === 0;
        btnEnd.disabled = true;
        if (btnRestart) btnRestart.disabled = true;
    }
}

/**
 * @description Inicia um novo turno no BACKEND.
 */
async function startShift() {
    if (localStorage.getItem('shiftActiveISO')) {
        showNotification('Já existe um turno ativo! Encerre o anterior primeiro.', 3.000);
        return;
    }
    if (activities.length === 0) {
        showNotification('Importe as atividades (planilha) primeiro.', 3.000);
        document.querySelector('.tab-btn').click();
        return;
    }

    // ================== INÍCIO DA CORREÇÃO ==================
    if (currentUser === 'N/A' || !currentUser) {
        const operatorId = prompt('Por favor, insira seu nome de Operador para iniciar o turno:', '');

        if (!operatorId || operatorId.trim() === '') {
            showNotification('Nome do Operador é obrigatório para iniciar.', 3.000, 'warning');
            return;
        }
        currentUser = operatorId.trim();
        localStorage.setItem('currentUser', currentUser);
    }
    // ================== FIM DA CORREÇÃO ==================

    const startTime = new Date().toISOString();
    let maxSeconds = 0;
    activities.forEach(t => {
        const seconds = timeToSeconds(t['T + (hh:mm)']);
        if (seconds !== null && seconds > maxSeconds) {
            maxSeconds = seconds;
        }
    });

    try {
        const response = await fetch(`${API_URL}/api/turnos/iniciar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operator: currentUser,
                shiftStart: startTime,
                ditlTotalSeconds: maxSeconds
            })
        });

        if (!response.ok) throw new Error('Falha ao iniciar turno no backend');

        await loadState();

        const execButton = document.querySelector(".tab-btn[onclick*='execucao']");
        showTab('execucao', execButton);

        updateStats();

        if (executingActivity && executingActivity.tasks.length > 0) {
            showNotification(`Turno iniciado! Clique em "Iniciar" na primeira tarefa.`, 4.000);
        } else {
            showNotification('Turno iniciado! Nenhuma tarefa encontrada.', 3.000, 'warning');
        }

    } catch (error) {
        console.error("Erro ao iniciar turno:", error);
        showNotification("ERRO: Não foi possível iniciar o turno.", 5.000, 'critical');
    }
}

function openEndShiftConfirmation() {
    if (!executingActivity || !localStorage.getItem('shiftActiveISO')) {
        showNotification('Nenhum turno ativo para encerrar.', 3000);
        return;
    }
    const nonCompleted = executingActivity.tasks.filter(t => !t.completed).length;
    if (nonCompleted === 0) {
        confirmEndShift(false);
        return;
    }
    document.getElementById('pendingTaskMessage').innerHTML = `Ainda há ${nonCompleted} tarefas não concluídas. Deseja encerrar o turno e gerar o relatório mesmo assim?`;
    document.getElementById('confirmEndShiftModal').classList.remove('hidden');
}

function closeEndShiftConfirmation() {
    document.getElementById('confirmEndShiftModal').classList.add('hidden');
}


/**
 * @description Encerra o turno no BACKEND.
 */
async function confirmEndShift(wasForced) {
    closeEndShiftConfirmation();

    if (executingActivity === null) return;

    executingActivity.tasks.forEach(task => {
        if (task._stopwatchRunning) {
            pauseStopwatch(task.id);
        }
    });

    if (masterClockInterval) clearInterval(masterClockInterval);
    masterClockInterval = null;
    document.getElementById('masterClockTime').textContent = '--:--:--';
    document.getElementById('masterClockTime').style.color = '#fff';
    document.getElementById('elapsedClockTime').textContent = '--:--:--';
    document.getElementById('elapsedClockTime').style.color = '#fff';

    const endTime = new Date().toISOString();

    try {
        const response = await fetch(`${API_URL}/api/turnos/${executingActivity.instanceId}/encerrar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shiftEnd: endTime })
        });

        if (!response.ok) throw new Error('Falha ao encerrar o turno no backend');

        localStorage.removeItem('shiftActiveISO');
        executingActivity = null;

        renderHeaderStatus();
        updateStats();

        const reportButton = document.querySelector(".tab-btn[onclick*='relatorios']");
        showTab('relatorios', reportButton);

        showNotification('Turno encerrado com sucesso. Relatório gerado!', 4000);

    } catch (error) {
        console.error("Erro ao encerrar turno:", error);
        showNotification("ERRO: Falha ao salvar encerramento do turno.", 5000, 'critical');
    }
}

function endShift() {
    openEndShiftConfirmation();
}

function clearAllData() {
    document.getElementById('confirmClearDataModal').classList.remove('hidden');
}

function closeClearDataConfirmation() {
    document.getElementById('confirmClearDataModal').classList.add('hidden');
}

async function confirmClearAllData() {
    closeClearDataConfirmation();

    try {
        const response = await fetch(`${API_URL}/api/atividades-importadas`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Falha ao limpar a tabela no backend.');
        localStorage.clear();
        activities = [];
        executingActivity = null;

        showNotification("SUCESSO: Dados do servidor e locais foram limpos!", 3000);
        setTimeout(() => location.reload(), 3000);

    } catch (error) {
        console.error("Erro ao limpar dados:", error);
        showNotification("ERRO: Não foi possível limpar os dados do servidor.", 4000, 'critical');
    }
}

async function openRestartShiftConfirmation() {
    if (!executingActivity || !localStorage.getItem('shiftActiveISO')) {
        showNotification('Nenhum turno ativo para reiniciar.', 3000);
        return;
    }
    document.getElementById('confirmRestartShiftModal').classList.remove('hidden');
}

function closeRestartShiftConfirmation() {
    document.getElementById('confirmRestartShiftModal').classList.add('hidden');
}

/**
 * @description Reinicia o turno (encerra o antigo, inicia um novo).
 */
async function confirmRestartShift() {
    closeRestartShiftConfirmation();
    if (!executingActivity) return;

    showNotification('Reiniciando o turno...', 3000);
    executingActivity.tasks.forEach(task => {
        if (task._stopwatchRunning) {
            pauseStopwatch(task.id);
        }
    });
    if (masterClockInterval) clearInterval(masterClockInterval);
    masterClockInterval = null;

    try {
        await fetch(`${API_URL}/api/turnos/${executingActivity.instanceId}/encerrar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shiftEnd: new Date().toISOString(),
                status: 'cancelado_reinicio'
            })
        });
        localStorage.removeItem('shiftActiveISO');
        executingActivity = null;
        await startShift();

        showNotification('Turno reiniciado com sucesso!', 4000);

    } catch (error) {
        console.error("Erro ao reiniciar turno:", error);
        showNotification("ERRO: Falha ao reiniciar turno.", 5000, 'critical');
    }
}


// ==================== RELÓGIO MESTRE (igual) ====================
function startMasterClock(totalDurationInSeconds) {
    if (masterClockInterval) clearInterval(masterClockInterval);

    const clockElRegressive = document.getElementById('masterClockTime');
    const clockElProgressive = document.getElementById('elapsedClockTime');

    if (!executingActivity || executingActivity.status !== 'ativo') {
        clockElRegressive.textContent = '--:--:--';
        clockElProgressive.textContent = '--:--:--';
        return;
    }

    const shiftStart = new Date(executingActivity.shiftStart).getTime();

    masterClockInterval = setInterval(() => {
        if (!executingActivity || executingActivity.status !== 'ativo') {
            clearInterval(masterClockInterval);
            masterClockInterval = null;
            return;
        }

        const now = new Date().getTime();
        const elapsedSeconds = Math.floor((now - shiftStart) / 1000);
        const remainingSeconds = totalDurationInSeconds - elapsedSeconds;

        clockElProgressive.textContent = formatSeconds(elapsedSeconds);
        clockElRegressive.textContent = formatSeconds(remainingSeconds);

        if (remainingSeconds < 0) {
            clockElRegressive.style.color = '#f44336';
        } else if (remainingSeconds < 60) {
            clockElRegressive.style.color = '#FFD54F';
        } else {
            clockElRegressive.style.color = '#fff';
        }

        clockElProgressive.style.color = '#fff';

    }, 1000);
}


// ==================== LÓGICA DO CRONÓMETRO E FLUXO DE TAREFAS ====================

function triggerNextTaskBanner(taskId) {
    if (!executingActivity) return false;
    const task = executingActivity.tasks.find(t => t.id === taskId);
    if (!task || task._nextTaskAlertShown) {
        return false;
    }
    const currentIndex = executingActivity.tasks.findIndex(t => t.id === task.id);
    if (currentIndex !== -1 && (currentIndex + 1) < executingActivity.tasks.length) {
        const nextTask = executingActivity.tasks[currentIndex + 1];
        if (nextTask && !nextTask.completed) {
            task._nextTaskAlertShown = true;
            showNextTaskBanner(nextTask['Event / Action']);
            return true;
        }
    }
    return false;
}

/**
 * @description Inicia o cronômetro (APENAS LOCALMENTE).
 */
function startStopwatch(taskId) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;
    const currentlyRunning = executingActivity.tasks.find(t => t._stopwatchRunning);
    if (currentlyRunning && currentlyRunning.id !== taskId) {
        showNotification(`A tarefa '${currentlyRunning['Event / Action']}' já está em execução. Pause-a primeiro.`, 5000, 'warning');
        return;
    }
    if (task._stopwatchRunning) {
        showNotification('Cronómetro já em execução para esta tarefa.');
        return;
    }
    task._stopwatchRunning = true;
    task._stopwatchStart = new Date().getTime();
    task.status = 'em execução';
    task.due = false;
    updateExecutionTaskUI(taskId);
    stopwatchIntervals[taskId] = setInterval(() => {
        const now = new Date().getTime();
        const sessionElapsedSeconds = Math.floor((now - task._stopwatchStart) / 1000);
        const totalElapsed = (task.runtimeSeconds || 0) + sessionElapsedSeconds;
        const el = document.getElementById(`timer-${taskId}`);
        if (!el) return;

        let elapsedText = '';
        let targetText = '';
        let elapsedColor = '';

        if (task.timeMode === 'countdown') {
            const timeLeft = task.targetSeconds - totalElapsed;
            const displayTime = formatSeconds(Math.abs(timeLeft));
            elapsedText = timeLeft >= 0 ? `Restante: ${displayTime}` : `ATRASO: ${displayTime}`;
            elapsedColor = timeLeft >= 0 ? '#F27EBE' : '#f44336';
            const targetTime = secondsToHHMM(task.targetSeconds);
            targetText = `Máximo: ${targetTime} (Regressiva)`;
            if (timeLeft <= 10 && timeLeft > 0 && !task._nextTaskAlertShown) {
                triggerNextTaskBanner(task.id);
            }

        } else if (task.timeMode === 'scheduled' && task.scheduledLimitISO) {
            const scheduledTime = new Date(task.scheduledLimitISO).getTime();
            const timeLeftMs = scheduledTime - now;
            const timeLeftSeconds = Math.floor(timeLeftMs / 1000);
            const displayTime = formatSeconds(Math.abs(timeLeftSeconds));
            elapsedText = timeLeftSeconds >= 0 ? `Faltam: ${displayTime}` : `ATRASO: ${displayTime}`;
            elapsedColor = timeLeftSeconds >= 0 ? '#F27EBE' : '#f44336';
            const alertTimeStr = new Date(task.scheduledAlertISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const limitTimeStr = new Date(task.scheduledLimitISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            targetText = `Janela: ${alertTimeStr} - ${limitTimeStr} (Programado)`;
        } else {
            const displayTime = formatSeconds(totalElapsed);
            elapsedText = `Decorrido: ${displayTime}`;
            elapsedColor = '#F27EBE';
            targetText = `Previsão: ${task['T + (hh:mm)'] || '--:--'} (Manual)`;
        }

        el.querySelector('.elapsed').textContent = elapsedText;
        el.querySelector('.elapsed').style.color = elapsedColor;
        el.querySelector('.target').textContent = targetText;
    }, 1000);
}


/**
 * @description Pausa o cronômetro e ATUALIZA O BACKEND.
 */
async function pauseStopwatch(taskId) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task || !task._stopwatchRunning) return;
    clearInterval(stopwatchIntervals[taskId]);
    delete stopwatchIntervals[taskId];
    const sessionDurationSeconds = Math.floor((new Date().getTime() - task._stopwatchStart) / 1000);
    task.runtimeSeconds = (task.runtimeSeconds || 0) + sessionDurationSeconds;
    task._stopwatchRunning = false;
    task._stopwatchStart = null;
    task.status = 'pendente';
    try {
        await fetch(`${API_URL}/api/tarefa/${taskId}/atualizar-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'pendente',
                runtimeSeconds: task.runtimeSeconds
            })
        });
        updateExecutionTaskUI(taskId);
        showNotification(`Tarefa pausada: ${task['Event / Action']}.`, 2000, 'warning');

    } catch (error) {
        console.error("Erro ao pausar tarefa:", error);
        showNotification("ERRO: Falha ao salvar pausa no servidor.", 4000, 'critical');
    }
}

/**
 * @description Lógica de Sucesso/Falha (com gatilhos de banner).
 */
function stopAndComplete(taskId, success) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;
    if (task._stopwatchRunning) {
        clearInterval(stopwatchIntervals[taskId]);
        delete stopwatchIntervals[taskId];
        const sessionDurationSeconds = Math.floor((new Date().getTime() - task._stopwatchStart) / 1000);
        task.runtimeSeconds = (task.runtimeSeconds || 0) + sessionDurationSeconds;
        task._stopwatchRunning = false;
        task._stopwatchStart = null;
    }
    if (success) {
        openEvidenceModal(taskId, true);
        return;
    }
    if (!success) {
        currentTaskToComplete = { taskId: taskId, success: false };
        openFailDecisionModal();
    }
}

function openFailDecisionModal() {
    document.getElementById('failDecisionModal').classList.remove('hidden');
}

function closeFailDecisionModal() {
    document.getElementById('failDecisionModal').classList.add('hidden');
}

function handleFailRetry() {
    closeFailDecisionModal();
    const taskId = currentTaskToComplete.taskId;
    restartTask(taskId);
}

function handleFailContinue() {
    closeFailDecisionModal();
    const taskId = currentTaskToComplete.taskId;
    openEvidenceModal(taskId, false);
}


function checkScheduledAlerts() {
    if (!executingActivity || !localStorage.getItem('shiftActiveISO')) return;
    const now = new Date().getTime();
    let changed = false;
    executingActivity.tasks.forEach(t => {
        if (!t.completed && t.timeMode === 'scheduled' && t.scheduledAlertISO) {
            const alertTime = new Date(t.scheduledAlertISO).getTime();
            if (now >= alertTime && !t.alerted) {
                t.alerted = true;
                changed = true;
                showNotification(`ALERTA: Tarefa "${t['Event / Action']}" atingiu o horário programado!`, 10000, 'critical');
            }
        }
    });
    if (changed) {
        renderExecutionTasks();
    }
}

function startAlertChecker() {
    if (alertCheckerInterval) clearInterval(alertCheckerInterval);
    alertCheckerInterval = setInterval(checkScheduledAlerts, 5000);
}


// ==================== MODAL DE EVIDÊNCIAS ====================

function openEvidenceModal(taskId, success) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;
    currentTaskToComplete = { taskId, success };
    document.getElementById('evidenceModalTaskName').textContent = task['Event / Action'];
    document.getElementById('evidenceModalObservation').value = task.observation || '';
    const operatorInput = document.getElementById('evidenceModalOperatorId');
    operatorInput.value = task.operatorTask || currentUser || '';
    const btn = document.getElementById('evidenceSubmitButton');
    btn.textContent = success ? 'Concluir com SUCESSO' : 'Concluir com FALHA';
    btn.style.background = success ? '#4CAF50' : '#f44336';
    renderEvidencePhotoPreview(task.photos || []);
    document.getElementById('evidenceModal').classList.remove('hidden');
    if (operatorInput.value === '') {
        operatorInput.focus();
    } else {
        document.getElementById('evidenceModalObservation').focus();
    }
}

function closeEvidenceModal() {
    document.getElementById('evidenceModal').classList.add('hidden');
    currentTaskToComplete = { taskId: null, success: null };
    document.getElementById('evidenceFileInput').value = '';
}

function renderEvidencePhotoPreview(photos) {
    const previewEl = document.getElementById('evidencePhotoPreview');
    previewEl.innerHTML = '';
    photos.forEach((dataURL, index) => {
        const photoContainerHtml = `
            <div style="position: relative; display: inline-block;">
                <img src="${dataURL}" class="img-preview" style="display:block; margin-right:5px; max-width:80px; max-height:60px; border-radius:4px;">
                <button class="btn-small btn-secondary" onclick="removePhotoFromEvidenceModal('${currentTaskToComplete.taskId}', ${index})" style="position: absolute; top: 0; right: 0; padding: 2px 4px; background: rgba(244, 67, 54, 0.8); color: #fff; line-height: 1; font-size: 10px; transform: none;">❌</button>
            </div>
        `;
        previewEl.insertAdjacentHTML('beforeend', photoContainerHtml);
    });
    const addButton = document.querySelector('#evidenceModal .btn-secondary');
    const maxPhotos = 3;
    if (photos.length >= maxPhotos) {
        addButton.setAttribute('disabled', 'disabled');
        addButton.textContent = `Limite de ${maxPhotos} fotos atingido`;
    } else {
        addButton.removeAttribute('disabled');
        addButton.textContent = 'Adicionar foto';
    }
}

function addPhotosToEvidenceModal() {
    const taskId = currentTaskToComplete.taskId;
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;
    if (!task.photos) task.photos = [];
    const files = Array.from(document.getElementById('evidenceFileInput').files);
    const maxAllowed = 3 - task.photos.length;
    const filesToAdd = files.slice(0, maxAllowed);
    if (filesToAdd.length === 0) {
        document.getElementById('evidenceFileInput').value = '';
        return;
    }
    let filesProcessed = 0;
    const totalFiles = filesToAdd.length;
    filesToAdd.forEach(f => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            task.photos.push(ev.target.result);
            filesProcessed++;
            if (filesProcessed === totalFiles) {
                renderEvidencePhotoPreview(task.photos);
                document.getElementById('evidenceFileInput').value = '';
            }
        };
        reader.readAsDataURL(f);
    });
}

function removePhotoFromEvidenceModal(taskId, index) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task || !task.photos || index < 0 || index >= task.photos.length) return;
    task.photos.splice(index, 1);
    renderEvidencePhotoPreview(task.photos);
}


/**
 * @description Envia a tarefa concluída para o BACKEND.
 */
async function submitEvidenceAndComplete() {
    const { taskId, success } = currentTaskToComplete;
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;
    const operatorInput = document.getElementById('evidenceModalOperatorId');
    const operatorId = operatorInput.value.trim();
    const observation = document.getElementById('evidenceModalObservation').value.trim();
    if (operatorId === '') {
        showNotification('O ID do operador é obrigatório para finalizar.', 3000, 'warning');
        operatorInput.focus();
        return;
    }
    if (observation === '') {
        showNotification('A descrição/observação é obrigatória.', 3000, 'warning');
        document.getElementById('evidenceModalObservation').focus();
        return;
    }
    currentUser = operatorId;
    localStorage.setItem('currentUser', currentUser);
    if (!executingActivity.operator || executingActivity.operator === 'N/A') {
        executingActivity.operator = operatorId;
        renderHeaderStatus();
    }

    const completedTime = new Date().toISOString();
    const dadosParaEnviar = {
        success: success,
        operatorTask: operatorId,
        observation: observation,
        completedAt: completedTime,
        runtimeSeconds: task.runtimeSeconds || 0,
        photos: task.photos || []
    };

    try {
        const response = await fetch(`${API_URL}/api/tarefa/${taskId}/completar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dadosParaEnviar)
        });

        if (!response.ok) throw new Error('Falha ao salvar a tarefa no backend');
        task.operatorTask = operatorId;
        task.observation = observation;
        task.completed = true;
        task.status = success ? 'concluída (sucesso)' : 'concluída (falha)';
        task.success = success;
        task.completedAt = completedTime;
        task.due = false;
        updateExecutionTaskUI(taskId);
        showNotification(`Tarefa finalizada: ${task['Event / Action']} (${success ? 'Sucesso' : 'Falha'})`);
        updateProgress();
        closeEvidenceModal();

        const currentIndex = executingActivity.tasks.findIndex(t => t.id === taskId);
        if (currentIndex !== -1 && (currentIndex + 1) < executingActivity.tasks.length) {
            const nextTask = executingActivity.tasks[currentIndex + 1];
            if (nextTask && !nextTask.completed && !nextTask._stopwatchRunning) {

                triggerNextTaskBanner(taskId);
                startStopwatch(nextTask.id);
                showNotification(`Próxima tarefa iniciada: ${nextTask['Event / Action']}`, 3000);
            }
        } else {
            showNotification('Todas as tarefas da sequência foram concluídas!', 4000);
            openEndShiftConfirmation();
        }

    } catch (error) {
        console.error("Erro no submitEvidenceAndComplete:", error);
        showNotification("ERRO: Falha ao salvar conclusão. Tente novamente.", 4000, 'critical');
    }
}

function showNextTaskBanner(nextTaskName) {
    const modal = document.getElementById('nextTaskModal');
    const nameEl = document.getElementById('nextTaskNameDisplay');
    if (!modal || !nameEl) {
        console.error('Elemento do banner (nextTaskModal ou nextTaskNameDisplay) não encontrado no HTML.');
        return;
    }
    nameEl.textContent = nextTaskName;
    modal.classList.remove('hidden');
}

function hideNextTaskBanner() {
    const modal = document.getElementById('nextTaskModal');
    modal.classList.add('hidden');
}

/**
 * @description Reinicia a tarefa no BACKEND.
 */
async function restartTask(taskId) {
    if (!executingActivity) return;
    const task = executingActivity.tasks.find(t => t.id === taskId);
    if (!task) return;

    if (!confirm(`Tem certeza de que deseja reiniciar a tarefa "${task['Event / Action']}"?\n\nTodo o progresso (tempo, fotos, observações) será perdido.`)) {
        return;
    }

    if (task._stopwatchRunning) {
        pauseStopwatch(taskId);
    }

    try {
        const response = await fetch(`${API_URL}/api/tarefa/${taskId}/reiniciar`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Falha ao reiniciar no backend');

        task.status = 'pendente';
        task.runtimeSeconds = 0;
        task._stopwatchRunning = false;
        task._stopwatchStart = null;
        task._nextTaskAlertShown = false;
        task.completed = false;
        task.completedAt = null;
        task.photos = [];
        task.operatorTask = '';
        task.observation = '';
        task.due = false;
        task.alerted = false;
        task.success = null;

        updateExecutionTaskUI(taskId); 
        updateProgress();
        showNotification(`Tarefa "${task['Event / Action']}" foi reiniciada.`, 3000, 'warning');
        
        startStopwatch(taskId);

    } catch (error) {
        console.error("Erro ao reiniciar tarefa:", error);
        showNotification("ERRO: Falha ao reiniciar tarefa.", 4000, 'critical');
    }
}


// ==================== RENDERIZAÇÃO DA UI (Maioria igual) ====================

function updateStats() {
    const totalActivities = activities.length;
    const activeExecutions = executingActivity ? 1 : 0;

    const totalActivitiesEl = document.getElementById('totalActivities');
    const activeActivitiesEl = document.getElementById('activeActivities');
    if (totalActivitiesEl) totalActivitiesEl.textContent = totalActivities;
    if (activeActivitiesEl) activeActivitiesEl.textContent = activeExecutions;
}

function renderExecutionInstances() {
    const listEl = document.getElementById('activityList');
    listEl.innerHTML = '';

    if (executingActivity && executingActivity.status === 'ativo') {
        const inst = executingActivity;
        const total = inst.tasks.length;
        const done = inst.tasks.filter(t => t.completed).length;
        const isSelected = true;
        const progressPercent = (total > 0 ? (done / total) * 100 : 0).toFixed(0);
        const startTime = new Date(inst.shiftStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        listEl.innerHTML = `
            <div class="activity-card card" style="transform: translateY(0); border-color:#F20587; border: 2px solid #F20587;">
                <div class="fw-700">Turno: ${new Date(inst.shiftStart).toLocaleDateString()}, ${startTime}</div>
                <div class="small">Operador: ${inst.operator}</div>
                <div class="small">Progresso: ${done}/${total} (${progressPercent}%)</div>
            </div>
        `;
    } else if (activities.length > 0) {
        listEl.innerHTML = `<div class="small text-center p-12">Nenhum turno ativo. Inicie um novo turno ou selecione um na aba relatórios.</div>`;
        document.getElementById('executionPanel').classList.add('hidden');
    } else {
        listEl.innerHTML = `<div class="small text-center p-12">Importe as atividades na aba "Cadastro" para começar.</div>`;
        document.getElementById('executionPanel').classList.add('hidden');
    }
}

function selectExecutionInstance(instanceId) {
    if (!executingActivity || executingActivity.instanceId !== instanceId) {
        if (!executingActivity) return;
    }

    const panel = document.getElementById('executionPanel');
    const title = document.getElementById('executionTitle');
    const executionFilterEl = document.getElementById('executionFilter');
    if (executionFilterEl) executionFilterEl.value = 'todos';
    title.textContent = `Executando: Turno de ${new Date(executingActivity.shiftStart).toLocaleDateString()} (Operador: ${executingActivity.operator})`;
    panel.classList.remove('hidden');
    updateProgress();
    renderExecutionTasks();
}

function updateProgress() {
    if (!executingActivity) return;
    const total = executingActivity.tasks.length;
    const done = executingActivity.tasks.filter(t => t.completed).length;
    const progressPercent = total > 0 ? ((done / total) * 100).toFixed(0) : 0;
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
        progressBar.textContent = `${progressPercent}%`;
    }
}

function renderExecutionTasks() {
    if (!executingActivity) return;
    const listEl = document.getElementById('executionTasks');
    listEl.innerHTML = '';
    const filterValue = document.getElementById('executionFilter')?.value || 'todos';

    executingActivity.tasks.forEach(task => {
        if (!task['Event / Action']) {
            const modelo = activities.find(a => a['Proc. ID'] === task.procId);
            if (modelo) {
                task['Event / Action'] = modelo['Event / Action'];
                task['Key Acceptance Criteria'] = modelo['Key Acceptance Criteria'];
                task['T + (hh:mm)'] = modelo['T + (hh:mm)'];
            }
        }
    });

    const filteredTasks = executingActivity.tasks.filter(task => {
        if (task.completed) {
            return filterValue === 'todos' || filterValue === 'concluida';
        }
        if (task.status === 'em execução' || task._stopwatchRunning) {
            return filterValue === 'todos' || filterValue === 'em execucao';
        }
        if (task.runtimeSeconds > 0 && !task.completed) {
            return filterValue === 'todos' || filterValue === 'pausada';
        }
        if (task.runtimeSeconds === 0 && !task.completed) {
            return filterValue === 'todos' || filterValue === 'nao iniciada' || filterValue === 'pendente';
        }
        return false;
    });
    if (filteredTasks.length === 0) {
        listEl.innerHTML = `<div class="small text-center p-12">Nenhuma tarefa encontrada com o filtro atual.</div>`;
        return;
    }
    filteredTasks.forEach(task => {
        let taskEl = document.getElementById(`task-item-${task.id}`);
        if (!taskEl) {
            taskEl = document.createElement('div');
            taskEl.id = `task-item-${task.id}`;
            listEl.appendChild(taskEl);
        }
        updateExecutionTaskUI(task.id);
    });
}

function updateExecutionTaskUI(taskId) {
    if (!executingActivity) return;
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;

    let taskEl = document.getElementById(`task-item-${taskId}`);
    if (!taskEl) return;

    const isRunning = task._stopwatchRunning;
    const isCompleted = task.completed;
    const isDue = task.due;
    const isAlerted = task.alerted;
    const isPaused = !isRunning && !isCompleted && task.runtimeSeconds > 0;
    const isPending = !isRunning && !isCompleted && !isPaused;

    let buttonsHtml = '';
    let statusText = '';
    let statusColor = '';
    let elapsedText = '';
    let targetText = '';
    let elapsedColor = '';

    if (isCompleted) {
        statusText = task.success ? 'CONCLUÍDA (SUCESSO)' : 'CONCLUÍDA (FALHA)';
        statusColor = task.success ? '#4CAF50' : '#f44336';
        buttonsHtml = `
            <button class="btn-small btn-secondary" disabled>Finalizado</button>
            <button class="btn-small" onclick="downloadTaskPDF('${task.id}')">PDF (Unitário)</button>
            <button class="btn-small btn-secondary" onclick="restartTask('${task.id}')">Reiniciar Tarefa</button>
        `;
    } else if (isRunning) {
        statusText = 'EM EXECUÇÃO';
        statusColor = '#F20587';
        buttonsHtml = `
            <button class="btn-small btn-secondary" onclick="pauseStopwatch('${task.id}')">Pausar</button>
            <button class="btn-small" style="background:#4CAF50" onclick="stopAndComplete('${task.id}', true)">SUCESSO</button>
            <button class="btn-small" style="background:#f44336" onclick="stopAndComplete('${task.id}', false)">FALHA</button>
        `;
    } else if (isPaused) {
        statusText = 'PAUSADA';
        statusColor = '#FFD54F';
        buttonsHtml = `
            <button class="btn-small" onclick="startStopwatch('${task.id}')">Retomar</button>
            <button class="btn-small" style="background:#4CAF50" onclick="stopAndComplete('${task.id}', true)">SUCESSO</button>
            <button class="btn-small" style="background:#f44336" onclick="stopAndComplete('${task.id}', false)">FALHA</button>
        `;
    } else {
        statusText = isDue ? 'PENDENTE (ATRASADO)' : 'NÃO INICIADA';
        statusColor = isDue ? '#f44336' : '#F27EBE';
        const firstPending = executingActivity.tasks.find(t => !t.completed && !t._stopwatchRunning);
        if (firstPending && firstPending.id === task.id) {
            buttonsHtml = `<button class="btn-small" onclick="startStopwatch('${task.id}')">Iniciar</button>`;
        } else {
            buttonsHtml = `<button class="btn-small btn-secondary" disabled>Em espera</button>`;
        }
    }

    if (isRunning) {
        elapsedColor = statusColor;
        targetText = `Previsão: ${escapeHtml(task['T + (hh:mm)'] || '--:--')} (Manual)`;
        if (task.timeMode === 'countdown') {
            targetText = `Máximo: ${secondsToHHMM(task.targetSeconds)} (Regressiva)`;
        } else if (task.timeMode === 'scheduled') {
            const alertTimeStr = new Date(task.scheduledAlertISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const limitTimeStr = new Date(task.scheduledLimitISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            targetText = `Janela: ${alertTimeStr} - ${limitTimeStr} (Programado)`;
        }
    } else {
        elapsedColor = isCompleted ? '#4CAF50' : (isPaused || isDue ? statusColor : '#F27EBE');
        if (task.timeMode === 'countdown' && task.targetSeconds > 0) {
            const timeLeft = task.targetSeconds - (task.runtimeSeconds || 0);
            const displayTime = formatSeconds(Math.abs(timeLeft));
            const pauseText = isPaused ? '(Pausado)' : (isPending ? '(Não iniciado)' : '');
            elapsedText = timeLeft >= 0 ? `Restante: ${displayTime} ${pauseText}` : `ATRASO: ${displayTime} ${pauseText}`;
            elapsedColor = timeLeft >= 0 ? elapsedColor : '#f44336';
            const targetTime = secondsToHHMM(task.targetSeconds);
            targetText = `Máximo: ${targetTime} (Regressiva)`;
        } else if (task.timeMode === 'scheduled' && task.scheduledLimitISO) {
            const nowTime = new Date().getTime();
            const scheduledTime = new Date(task.scheduledLimitISO).getTime();
            const timeLeftSeconds = Math.floor((scheduledTime - nowTime) / 1000);
            const displayTime = formatSeconds(Math.abs(timeLeftSeconds));
            const pauseText = isPaused ? '(Pausado)' : (isPending ? '(Não iniciado)' : '');
            elapsedText = timeLeftSeconds >= 0 ? `Faltam: ${displayTime} ${pauseText}` : `ATRASO: ${displayTime} ${pauseText}`;
            elapsedColor = timeLeftSeconds >= 0 ? elapsedColor : '#f44336';
            const alertTimeStr = new Date(task.scheduledAlertISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const limitTimeStr = new Date(task.scheduledLimitISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            targetText = `Janela: ${alertTimeStr} - ${limitTimeStr} (Programado)`;
        } else {
            elapsedText = `Decorrido: ${formatSeconds(task.runtimeSeconds)}`;
            targetText = `Previsão: ${escapeHtml(task['T + (hh:mm)'] || '--:--')} (Manual)`;
        }
    }

    let taskClass = `task-item ${isCompleted ? 'completed' : ''} ${isDue && !isCompleted ? 'task-due' : ''} ${isPaused ? 'task-paused' : ''}`;
    if (isRunning) taskClass = taskClass.replace('task-due', '').replace('task-paused', '');
    taskEl.className = taskClass;
    taskEl.innerHTML = `
        <div class="task-header">
            <div>
                <h4 class="mb-4" style="color:${isCompleted ? '#F0F0F2' : statusColor};">${escapeHtml(task['Event / Action'] || 'Carregando...')}</h4>
                <div class="small"><strong>Status:</strong> ${statusText}</div>
                <div class="small"><strong>Operador:</strong> ${escapeHtml(task.operatorTask || 'N/A')}</div>
                ${isAlerted && !isCompleted ? `<div class="small fw-700" style="color:#f44336;">ALERTA DE PRAZO!</div>` : ''}
            </div>
            <div class="time-display" id="timer-${task.id}">
                <div class="elapsed fw-700" style="color:${elapsedColor}">${elapsedText}</div>
                <div class="target small">${targetText}</div>
            </div>
        </div>
        <div class="small" style="opacity:0.9;"><strong>Critério:</strong> ${escapeHtml(task['Key Acceptance Criteria'] || 'Carregando...')}</div>
        <div class="btn-group">
            ${buttonsHtml}
        </div>
    `;
}

// ==================== ABA CADASTRO (Importação) ====================

function filterActivities() {
    renderActivityPreview();
}

function renderActivityPreview() {
    const listEl = document.getElementById('taskPreview');
    const searchInput = document.getElementById('searchActivitiesInput');
    const filterText = searchInput ? searchInput.value.toLowerCase() : '';
    const filteredActivities = activities.filter(t =>
        t['Event / Action'].toLowerCase().includes(filterText) ||
        t['Proc. ID'].toLowerCase().includes(filterText) ||
        filterText === ''
    );
    if (filteredActivities.length === 0) {
        listEl.innerHTML = `<div class="small text-center p-12">Nenhuma atividade corresponde ao filtro.</div>`;
        return;
    }
    listEl.innerHTML = filteredActivities.map((t, index) => `
        <div class="task-item" style="border-left-color:#F27EBE; transition:none; transform:none;">
            <h4 class="mb-4">${index + 1}. ${escapeHtml(t['Event / Action'])}</h4>
            <div class="small"><strong>Tempo Previsto:</strong> ${escapeHtml(t['T + (hh:mm)'])}</div>
            <div class="small"><strong>Evento/Grupo:</strong> ${escapeHtml(t.Event)} | <strong>Proc. ID:</strong> ${escapeHtml(t['Proc. ID'])}</div>
            <div class="small"><strong>Critério:</strong> ${escapeHtml(t['Key Acceptance Criteria'])}</div>
        </div>
    `).join('');
    document.getElementById('loadedSummary').textContent = `${filteredActivities.length} atividades visíveis (Total: ${activities.length}).`;
}

function onFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        parsedData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        if (parsedData.length === 0) return showNotification('Arquivo vazio ou inválido.', 3000, 'warning');
        headerRow = parsedData.shift();
        setupMappingModal();
    };
    reader.readAsArrayBuffer(file);
}

function setupMappingModal() {
    const modal = document.getElementById('mappingModal');
    const requiredMaps = ['mapTime', 'mapProc', 'mapEvent', 'mapAction', 'mapAcceptance'];
    requiredMaps.forEach(id => {
        document.getElementById(id).innerHTML = '';
    });
    headerRow.forEach((col, index) => {
        requiredMaps.forEach(id => {
            const selectEl = document.getElementById(id);
            const option = document.createElement('option');
            option.value = index;
            option.textContent = col;
            selectEl.appendChild(option);
        });
    });
    requiredMaps.forEach(id => {
        const selectEl = document.getElementById(id);
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = '— Não usar —';
        selectEl.prepend(emptyOption);
    });
    requiredMaps.forEach(id => {
        const selectEl = document.getElementById(id);
        for (let i = 0; i < selectEl.options.length; i++) {
            const optionText = selectEl.options[i].textContent;
            const index = selectEl.options[i].value;
            if (optionText.includes('T +') && id === 'mapTime') selectEl.value = index;
            if (optionText.includes('Proc.') && id === 'mapProc') selectEl.value = index;
            if (optionText.includes('Event') && id === 'mapEvent') selectEl.value = index;
            if (optionText.includes('Action') && id === 'mapAction') selectEl.value = index;
            if (optionText.includes('Criteria') && id === 'mapAcceptance') selectEl.value = index;
        }
    });
    let previewHtml = '<table><thead><tr>';
    headerRow.forEach(h => previewHtml += `<th>${escapeHtml(h)}</th>`);
    previewHtml += '</tr></thead><tbody>';
    parsedData.slice(0, 5).forEach(row => {
        previewHtml += '<tr>';
        row.forEach(cell => previewHtml += `<td>${escapeHtml(cell)}</td>`);
        previewHtml += '</tr>';
    });
    previewHtml += '</tbody></table>';
    document.getElementById('mappingPreview').innerHTML = previewHtml;
    modal.classList.remove('hidden');
}

function cancelMapping() {
    document.getElementById('mappingModal').classList.add('hidden');
}

/**
 * @description Envia as atividades do Excel para o BACKEND.
 */
async function confirmImport() {
    const map = {
        'T + (hh:mm)': document.getElementById('mapTime').value,
        'Proc. ID': document.getElementById('mapProc').value,
        'Event': document.getElementById('mapEvent').value,
        'Event / Action': document.getElementById('mapAction').value,
        'Key Acceptance Criteria': document.getElementById('mapAcceptance').value
    };

    const newActivities = parsedData.map(row => ({
        'T + (hh:mm)': row[map['T + (hh:mm)']] || '',
        'Proc. ID': row[map['Proc. ID']] || '',
        'Event': row[map['Event']] || '',
        'Event / Action': row[map['Event / Action']] || '',
        'Key Acceptance Criteria': row[map['Key Acceptance Criteria']] || ''
    })).filter(t => t['Event / Action']);

    try {
        const response = await fetch(`${API_URL}/api/atividades-importadas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activities: newActivities })
        });

        if (!response.ok) throw new Error('Falha ao salvar atividades no backend');
        activities = newActivities;
        cancelMapping();
        document.getElementById('loadedSummary').textContent = `${activities.length} atividades importadas com sucesso.`;
        document.getElementById('loadedContainer').classList.remove('hidden');
        updateStats();
        renderActivityPreview();
        showNotification('Planilha importada com sucesso!', 3000);
        renderHeaderStatus();

    } catch (error) {
        console.error("Erro ao importar planilha:", error);
        showNotification("ERRO: Falha ao salvar planilha no servidor.", 4000, 'critical');
    }
}


// ==================== RELATÓRIOS (Refatorado) ====================

function downloadJSON() {
    const data = {
        currentUser: currentUser,
        activities: activities,
        executingActivity: executingActivity
    };
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DITL_Backup_LOCAL_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('Dados LOCAIS exportados para JSON.', 2000);
}

/**
 * @description Busca todos os turnos (relatórios) do BACKEND.
 */
async function renderAllReports() {
    const reportListEl = document.getElementById('reportList');
    reportListEl.innerHTML = '<div class="small text-center p-12">Carregando relatórios...</div>';

    try {
        const response = await fetch(`${API_URL}/api/relatorios`);
        if (!response.ok) throw new Error('Falha ao buscar relatórios');

        executions = await response.json();

        const filterValue = document.getElementById('reportFilter').value;
        let filteredExecutions = executions;

        if (filterValue !== 'todos') {
            filteredExecutions = filteredExecutions.filter(e => e.status === filterValue);
        }

        if (filteredExecutions.length === 0) {
            reportListEl.innerHTML = `<div class="small text-center">Nenhum relatório encontrado com o filtro atual.</div>`;
            return;
        }

        reportListEl.innerHTML = '';

        filteredExecutions.forEach(inst => {
            const total = inst.tasksTotal || 0;
            const done = inst.tasksDone || 0;

            const isCompleted = inst.status === 'concluido';
            reportListEl.innerHTML += `
                <div class="task-item ${isCompleted ? 'completed' : ''}" style="cursor:pointer; padding:16px;" onclick="previewReport('${inst.instanceId}')">
                    <div class="task-header">
                        <div>
                            <h4 class="mb-4">Relatório do Turno: ${new Date(inst.inicioTurno).toLocaleDateString()}</h4>
                            <div class="small">Operador: ${inst.operadorResponsavel}</div>
                            <div class="small">Início: ${new Date(inst.inicioTurno).toLocaleTimeString()} | Fim: ${inst.fimTurno ? new Date(inst.fimTurno).toLocaleTimeString() : 'Em andamento'}</div>
                        </div>
                        <div>
                            <span class="success-badge ${isCompleted ? 'yes' : 'no'} mt-4">${isCompleted ? 'CONCLUÍDO' : (inst.status === 'ativo' ? 'ATIVO' : 'CANCELADO')}</span>
                        </div>
                    </div>
                    <div class="small mt-8">Tarefas: ${done}/${total} concluídas.</div>
                </div>
            `;
        });

    } catch (error) {
        console.error("Erro ao renderizar relatórios:", error);
        reportListEl.innerHTML = `<div class="small text-center p-12" style="color: #f44336;">Erro ao carregar relatórios.</div>`;
    }
}

/**
 * @description Busca dados completos de UM relatório do BACKEND.
 */
async function previewReport(instanceId) {
    currentReportInstanceId = instanceId;
    const innerEl = document.getElementById('reportPreviewInner');
    innerEl.innerHTML = '<div class="small text-center p-12">Carregando prévia...</div>';
    document.getElementById('reportPreviewModal').style.zIndex = '9999';
    document.getElementById('reportPreviewModal').classList.remove('hidden');

    try {
        const response = await fetch(`${API_URL}/api/relatorio/${instanceId}`);
        if (!response.ok) throw new Error('Falha ao buscar dados do relatório');

        const inst = await response.json();

        innerEl.innerHTML = generateReportHTML(inst);

    } catch (error) {
        console.error("Erro ao carregar prévia do relatório:", error);
        innerEl.innerHTML = `<div class="small text-center p-12" style="color: #f44336;">Erro ao carregar dados.</div>`;
    }
}

function closeReportPreview() {
    document.getElementById('reportPreviewModal').classList.add('hidden');
    document.getElementById('reportPreviewModal').style.zIndex = '4000';
    currentReportInstanceId = null;
}

// ==================== FUNÇÕES DE GERAÇÃO DE HTML DE RELATÓRIO ====================

function generateReportHTML(inst) {
    const totalTime = inst.tasks.reduce((acc, t) => acc + (t.runtimeSeconds || 0), 0);
    const totalTimeFormatted = formatSeconds(totalTime);
    let html = `
        <style>
            /* (Estilos do PDF - com os ajustes de fonte 10pt e fotos maiores) */
            .report-card { background: #fff; padding: 20px; border-radius: 8px; color: #000; font-family: sans-serif; font-size: 10pt; }
            .report-header h2 { font-size: 1.2rem; color: #F20587; }
            .report-info { margin-bottom: 12px; font-size: 10pt; }
            .report-task { border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; border-radius: 6px; page-break-inside: avoid; break-inside: avoid; }
            .task-title { font-weight: bold; color: #333; }
            .evidence-img { max-width: 150px; max-height: 120px; margin-right: 5px; border: 1px solid #eee; object-fit: cover; }
        </style>
        <div class="report-card">
        <div class="report-header" style="text-align:center;">
            <h2>RELATÓRIO DE EXECUÇÃO DITL</h2>
            <p>Sistema de Automação de Tarefas de Satélite</p>
        </div>
        <div class="report-info">
            <p><strong>Operador:</strong> ${escapeHtml(inst.operadorResponsavel)}</p>
            <p><strong>Turno Início:</strong> ${new Date(inst.inicioTurno).toLocaleString()}</p>
            <p><strong>Turno Fim:</strong> ${inst.fimTurno ? new Date(inst.fimTurno).toLocaleString() : 'Em andamento'}</p>
            <p><strong>Tempo Total Executado:</strong> ${totalTimeFormatted}</p>
        </div>
        <h3>Atividades Registradas:</h3>
        <hr style="border: 1px solid #ccc; margin-bottom: 10px;">
    `;
    inst.tasks.forEach(task => {
        const photosHtml = (task.photos || []).map(p => `<img src="${p}" class="evidence-img">`).join('');
        const taskStatus = task.completed ? (task.success ? 'SUCESSO' : 'FALHA') : 'NÃO CONCLUÍDA';
        let timeInfo = `Tempo: ${formatSeconds(task.runtimeSeconds)}`;

        if (task.timeMode === 'countdown' && task.targetSeconds > 0) {
            const targetDisplay = secondsToHHMM(task.targetSeconds);
            timeInfo += ` (Máximo: ${targetDisplay}, Modo: Regressiva)`;
        } else if (task.timeMode === 'scheduled' && task.scheduledLimitIso) {
            const alertTimeStr = new Date(task.scheduledAlertIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const limitTimeStr = new Date(task.scheduledLimitIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            timeInfo += ` (Janela: ${alertTimeStr} - ${limitTimeStr}, Modo: Programado)`;
        } else {
            timeInfo += ` (Modo: Manual)`;
        }

        html += `
            <div class="report-task">
                <div class="task-title">${escapeHtml(task['Event / Action'] || task.acao)}</div>
                <p><strong>Status:</strong> ${taskStatus} (${timeInfo})</p>
                <p><strong>Operador (Tarefa):</strong> ${escapeHtml(task.operatorTask || 'N/A')}</p>
                <p><strong>Concluído em:</strong> ${task.completedAt ? new Date(task.completedAt).toLocaleTimeString() : 'N/A'}</p>
                <p><strong>Observação:</strong> ${escapeHtml(task.observation || 'Nenhuma')}</p>
                <p><strong>Evidências:</strong></p>
                <div style="display: flex; flex-wrap: wrap;">${photosHtml}</div>
            </div>
        `;
    });
    html += `</div>`;
    return html;
}

function generateTaskReportHTML(task, inst) {
    const totalTimeFormatted = formatSeconds(task.runtimeSeconds || 0);
    let photosHtml = (task.photos || []).map(p => `<img src="${p}" class="evidence-img">`).join('');
    const taskStatus = task.completed ? (task.success ? 'SUCESSO' : 'FALHA') : 'NÃO CONCLUÍDA';
    let timeInfo = `Tempo: ${formatSeconds(task.runtimeSeconds)}`;

    if (task.timeMode === 'countdown' && task.targetSeconds > 0) {
        const targetDisplay = secondsToHHMM(task.targetSeconds);
        timeInfo += ` (Máximo: ${targetDisplay}, Modo: Regressiva)`;
    } else if (task.timeMode === 'scheduled' && task.scheduledLimitIso) {
        const alertTimeStr = new Date(task.scheduledAlertIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const limitTimeStr = new Date(task.scheduledLimitIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        timeInfo += ` (Janela: ${alertTimeStr} - ${limitTimeStr}, Modo: Programado)`;
    } else {
        timeInfo += ` (Modo: Manual)`;
    }
    return `
        <style>
            /* (Estilos do PDF - com os ajustes de fonte 10pt e fotos maiores) */
            .report-card { background: #fff; padding: 20px; border-radius: 8px; color: #000; font-family: sans-serif; font-size: 10pt; }
            .report-header h2 { font-size: 1.2rem; color: #F20587; }
            .report-info { margin-bottom: 12px; font-size: 10pt; }
            .report-task { border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; border-radius: 6px; page-break-inside: avoid; break-inside: avoid; }
            .task-title { font-weight: bold; color: #333; }
            .evidence-img { max-width: 150px; max-height: 120px; margin-right: 5px; border: 1px solid #eee; object-fit: cover; }
        </style>
        <div class="report-card">
        <div class="report-header" style="text-align:center;">
            <h2>RELATÓRIO DE TAREFA UNITÁRIA DITL</h2>
            <p style="font-size: 0.8rem;">Referente ao Turno de ${new Date(inst.shiftStart).toLocaleDateString()} (Operador: ${escapeHtml(inst.operator)})</p>
        </div>
        <div class="report-info">
            <p><strong>ID da Atividade:</strong> ${escapeHtml(task['Proc. ID'])}</p>
            <p><strong>Evento/Ação:</strong> ${escapeHtml(task['Event / Action'])}</p>
            <p><strong>Status:</strong> ${taskStatus} (${timeInfo})</p>
            <p><strong>Tempo Total Executado:</strong> ${totalTimeFormatted}</p>
        </div>
        <h3>Detalhes da Tarefa:</h3>
        <hr style="border: 1px solid #ccc; margin-bottom: 10px;">
        <div class="report-task" style="border-color:${task.success ? '#4CAF50' : '#f44336'};">
            <div class="task-title">${escapeHtml(task['Event / Action'])}</div>
            <p><strong>Operador (Tarefa):</strong> ${escapeHtml(task.operatorTask || 'N/A')}</p>
            <p><strong>Concluído em:</strong> ${task.completedAt ? new Date(task.completedAt).toLocaleTimeString() : 'N/A'}</p>
            <p><strong>Observação:</strong> ${escapeHtml(task.observation || 'Nenhuma')}</p>
            <p><strong>Critério de Aceitação:</strong> ${escapeHtml(task['Key Acceptance Criteria'])}</p>
            <p><strong>Evidências:</strong></p>
            <div style="display: flex; flex-wrap: wrap;">${photosHtml}</div>
        </div>
        </div>
    `;
}

async function downloadTaskPDF(taskId) {
    if (!executingActivity) return showNotification('Nenhum turno ativo.', 3000);
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return showNotification('Tarefa não encontrada.', 3000, 'warning');
    if (!task.completed) {
        return showNotification('A tarefa deve ser concluída para gerar o relatório unitário.', 3000, 'warning');
    }
    const reportHtml = generateTaskReportHTML(task, executingActivity);
    const tempContainer = document.createElement('div');
    tempContainer.id = `report-unitario-${taskId}`;
    tempContainer.innerHTML = reportHtml;
    tempContainer.style.width = '210mm';
    tempContainer.style.padding = '10mm';
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px';
    document.body.appendChild(tempContainer);
    const date = new Date(executingActivity.shiftStart).toISOString().slice(0, 10);
    try {
        await generatePdfFromElement(tempContainer, `Relatorio_Tarefa_${task['Proc. ID']}_${date}`);
        showNotification('PDF da Tarefa unitária gerado!', 3000);
    } catch (error) {
        console.error("Erro ao gerar PDF unitário:", error);
        showNotification('Erro ao gerar PDF da tarefa. Verifique o console.', 5000, 'critical');
    } finally {
        if (document.body.contains(tempContainer)) {
            document.body.removeChild(tempContainer);
        }
    }
}

async function downloadReportPDFFromPreview() {
    if (!currentReportInstanceId) {
        closeReportPreview();
        return;
    }

    const innerEl = document.getElementById('reportPreviewInner');
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = innerEl.innerHTML;
    tempContainer.style.width = '210mm';
    tempContainer.style.padding = '10mm';
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px';
    document.body.appendChild(tempContainer);

    const inst = executions.find(e => e.instanceId === currentReportInstanceId);
    const operatorName = inst ? inst.operadorResponsavel : 'Relatorio';
    const date = inst ? new Date(inst.inicioTurno).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    try {
        await generatePdfFromElement(tempContainer, `Relatorio_Turno_${operatorName}_${date}`);
        showNotification('PDF do Relatório individual gerado!', 3000);
    } catch (e) {
        showNotification('Erro ao gerar PDF.', 3000, 'critical');
    } finally {
        document.body.removeChild(tempContainer);
        closeReportPreview();
    }
}


async function generateFinalReportPDF() {
    if (executions.length === 0) {
        showNotification('Nenhuma execução registrada. Abra a aba "Relatórios" primeiro.', 3000, 'warning');
        await renderAllReports();
        if (executions.length === 0) return;
    }

    showNotification('Gerando relatório completo... Isso pode levar um tempo.', 5000);

    const tempContainer = document.createElement('div');
    tempContainer.style.width = '210mm';
    tempContainer.style.padding = '10mm';
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px';
    document.body.appendChild(tempContainer);

    try {
        for (let i = 0; i < executions.length; i++) {
            const instHeader = executions[i];

            const response = await fetch(`${API_URL}/api/relatorio/${instHeader.instanceId}`);
            if (!response.ok) continue;

            const instCompleto = await response.json();
            const reportHtml = generateReportHTML(instCompleto);

            const reportDiv = document.createElement('div');
            reportDiv.innerHTML = reportHtml;
            tempContainer.appendChild(reportDiv);

            if (i < executions.length - 1) {
                const hr = document.createElement('hr');
                hr.style.pageBreakAfter = 'always';
                tempContainer.appendChild(hr);
            }
        }

        await generatePdfFromElement(tempContainer, `Relatorio_Consolidado_DITL_FINAL_COMPLETO_${new Date().toISOString().slice(0, 10)}`);
        showNotification('Relatório Final (Completo) gerado com sucesso.', 3000);

    } catch (error) {
        console.error("Erro ao gerar PDF consolidado:", error);
        showNotification('Erro ao gerar PDF consolidado.', 5000, 'critical');
    } finally {
        document.body.removeChild(tempContainer);
    }
}

async function generatePdfFromElement(element, filename) {
    showNotification('Gerando PDF... Aguarde.', 3000);
    
    const { jsPDF } = window.jspdf;
    
    try {
        const canvas = await html2canvas(element, { 
            scale: 2,
            scrollY: -window.scrollY
        }); 

        const imgData = canvas.toDataURL('image/png');

        const imgWidth = 210;
        const pageHeight = 295;
        const imgHeight = canvas.height * imgWidth / canvas.width;
        
        const pdf = new jsPDF('p', 'mm', 'a4');
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        let heightLeft = imgHeight - pageHeight;

        while (heightLeft > 0) {
            position = -(imgHeight - heightLeft);
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
        }

        pdf.save(`${filename}.pdf`);
        showNotification('PDF gerado com sucesso!', 3000);

    } catch (error) {
        console.error("Erro ao gerar PDF (método html2canvas):", error);
        showNotification('Erro ao gerar PDF. Verifique o console.', 5000, 'critical');
    }
}

function checkDueTasks() {
    if (!executingActivity || !localStorage.getItem('shiftActiveISO')) return;
    const now = new Date();
    const shiftStart = new Date(executingActivity.shiftStart);
    const elapsedShiftSeconds = Math.floor((now.getTime() - shiftStart.getTime()) / 1000);
    let changed = false;
    executingActivity.tasks.forEach(t => {
        if (!t.completed && t.dueSeconds !== null) {
            if (elapsedShiftSeconds > t.dueSeconds) {
                if (!t.due) {
                    t.due = true;
                    changed = true;
                    showNotification(`ATENÇÃO: Tarefa "${t['Event / Action']}" está atrasada em relação ao previsto da planilha!`, 5000, 'warning');
                }
            } else {
                if (t.due) {
                    t.due = false;
                    changed = true;
                }
            }
        }
    });
    if (changed) {
        renderExecutionTasks();
    }
}

function startScheduledChecker() {
    if (dueCheckerInterval) clearInterval(dueCheckerInterval);
    dueCheckerInterval = setInterval(checkDueTasks, 30000);
}