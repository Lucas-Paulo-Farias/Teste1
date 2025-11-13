// server.js
const express = require('express');
const mysql = require('mysql2/promise'); // Usamos 'promise' para async/await
const cors = require('cors');

const app = express();
const port = 3000; // O backend rodará na porta 3000

// Middlewares
app.use(cors()); // Permite acesso do seu frontend
app.use(express.json({ limit: '50mb' })); // Permite JSON e aumenta o limite para as fotos em base64

// =================================================================
// ⚠️ CONFIGURE SEU BANCO DE DADOS AQUI ⚠️
// =================================================================
const dbConfig = {
    host: 'localhost',
    user: 'root', // <-- SEU USUÁRIO (ex: 'root')
    password: 'SeEsquecerEhCorno', // <-- SUA SENHA
    database: 'sistema_ditl'
};
// =================================================================

// Função helper para criar um pool de conexões
const pool = mysql.createPool(dbConfig);

// SUBSTITUA A FUNÇÃO 'toCamelCase' ANTIGA POR ESTA:

// Função helper para converter snake_case (DB) para camelCase (JS)
const toCamelCase = (rows) => {
    return rows.map(row => {
        const newRow = {};
        for (const key in row) {
            // [CORREÇÃO] Regex ajustado para funcionar corretamente
            const camelKey = key.replace(/_(\w)/g, (match, p1) => p1.toUpperCase());
            newRow[camelKey] = row[key];
        }
        return newRow;
    });
};

// ------ 🚀 INÍCIO DAS ROTAS DA API 🚀 ------

/**
 * @route GET /api/atividades-importadas
 * @desc Busca todas as atividades "modelo" (do Excel).
 */
app.get('/api/atividades-importadas', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM atividades_importadas ORDER BY id');
        res.json(toCamelCase(rows));
    } catch (error) {
        console.error('Erro em /api/atividades-importadas:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

// SUBSTITUA A ROTA 'POST /api/atividades-importadas' PELA VERSÃO ABAIXO

/**
 * @route POST /api/atividades-importadas
 * @desc Salva (substitui) a lista de atividades "modelo".
 */
app.post('/api/atividades-importadas', async (req, res) => {
    const { activities } = req.body; // Espera um array de atividades
    let conn; // Definimos a conexão aqui para usá-la no 'finally'

    try {
        conn = await pool.getConnection();
        await conn.beginTransaction(); // Inicia a transação

        // 1. Limpa a tabela antiga
        await conn.query('DELETE FROM atividades_importadas');
        // 2. Reseta o auto-incremento
        await conn.query('ALTER TABLE atividades_importadas AUTO_INCREMENT = 1');

        // 3. Insere as novas atividades
        const query = `
            INSERT INTO atividades_importadas 
            (tempo_previsto, proc_id, evento, acao, criterios_aceitacao) 
            VALUES (?, ?, ?, ?, ?)
        `;
        for (const act of activities) {
            await conn.query(query, [
                act['T + (hh:mm)'],
                act['Proc. ID'],
                act['Event'],
                act['Event / Action'],
                act['Key Acceptance Criteria']
            ]);
        }

        // 4. Se tudo deu certo, confirma as mudanças
        await conn.commit();
        
        res.status(201).json({ message: `${activities.length} atividades importadas.` });

    } catch (error) {
        console.error('Erro em POST /api/atividades-importadas:', error);
        
        // 5. [CORREÇÃO] Se algo deu errado, desfaz tudo
        if (conn) await conn.rollback();
        
        res.status(500).json({ error: 'Erro de servidor ao importar. A operação foi desfeita.' });
    } finally {
        // 6. [CORREÇÃO] Sempre libera a conexão de volta ao pool
        if (conn) conn.release();
    }
});

// SUBSTITUA A ROTA 'DELETE /api/atividades-importadas' PELA VERSÃO ABAIXO

/**
 * @route DELETE /api/atividades-importadas
 * @desc Limpa TODAS as atividades modelo (do Excel) e reseta o ID.
 */
app.delete('/api/atividades-importadas', async (req, res) => {
    let conn; // Definimos a conexão aqui para usá-la no 'finally'
    
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction(); // Inicia a transação

        // 1. Limpa a tabela
        await conn.query('DELETE FROM atividades_importadas');
        
        // 2. Reseta o auto-incremento para 1
        await conn.query('ALTER TABLE atividades_importadas AUTO_INCREMENT = 1');

        // 3. Confirma as mudanças
        await conn.commit();

        console.log('Tabela "atividades_importadas" foi limpa e resetada.');
        res.status(200).json({ message: 'Tabela de atividades importadas limpa.' });

    } catch (error) {
        console.error('Erro em DELETE /api/atividades-importadas:', error);
        
        // 4. [CORREÇÃO] Se algo deu errado, desfaz
        if (conn) await conn.rollback();
        
        res.status(500).json({ error: 'Erro de servidor ao limpar atividades.' });
    } finally {
        // 5. [CORREÇÃO] Sempre libera a conexão
        if (conn) conn.release();
    }
});


/**
 * @route GET /api/turno-ativo
 * @desc Busca o turno com status 'ativo', se houver, e suas tarefas.
 */
app.get('/api/turno-ativo', async (req, res) => {
    try {
        // 1. Encontra o turno ativo
        const [turnos] = await pool.query('SELECT * FROM turnos WHERE status = ?', ['ativo']);
        
        if (turnos.length === 0) {
            return res.json(null); // Nenhum turno ativo
        }

        const turnoAtivo = toCamelCase(turnos)[0];
        
// 2. Busca as tarefas desse turno
        const [tarefas] = await pool.query(
            // [CORREÇÃO] Ordena numericamente pela última parte do ID
            'SELECT * FROM tarefas_execucao WHERE turno_instance_id = ? ORDER BY CAST(SUBSTRING_INDEX(task_id, \'-\', -1) AS UNSIGNED)', 
            [turnoAtivo.instanceId]
        );
        const tarefasCamel = toCamelCase(tarefas);

        // 3. Busca as fotos de CADA tarefa
        for (let tarefa of tarefasCamel) {
            const [fotos] = await pool.query(
                'SELECT imagem_base64 AS base64 FROM evidencias_fotos WHERE task_id = ?', 
                [tarefa.taskId]
            );
            // Anexa as fotos (o frontend espera um array de strings base64)
            tarefa.photos = fotos.map(f => f.base64); 
        }
        
        // 4. Retorna o objeto que o frontend espera (turno + tarefas com fotos)
        turnoAtivo.tasks = tarefasCamel;
        res.json(turnoAtivo);

    } catch (error) {
        console.error('Erro em /api/turno-ativo:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

/**
 * @route POST /api/turnos/iniciar
 * @desc Cria um novo turno e todas as suas tarefas baseadas nas atividades-modelo.
 */
app.post('/api/turnos/iniciar', async (req, res) => {
    try {
        const { operator, shiftStart, ditlTotalSeconds } = req.body;
        const instanceId = `INST-${Date.now()}`;

        const conn = await pool.getConnection();
        await conn.beginTransaction();

// 1. Cria o Turno
        await conn.query(
            'INSERT INTO turnos (instance_id, operador_responsavel, inicio_turno, status) VALUES (?, ?, ?, ?)',
            [instanceId, operator, new Date(shiftStart), 'ativo'] // <-- ALTERADO AQUI
        );

        // 2. Busca as atividades-modelo para criar as tarefas
        const [atividades] = await conn.query('SELECT * FROM atividades_importadas ORDER BY id');
        
        const tarefasParaInserir = [];
        const queryTarefa = `
            INSERT INTO tarefas_execucao 
            (task_id, turno_instance_id, proc_id, acao, status, time_mode, target_seconds) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        
        // 3. Prepara e insere cada tarefa
        let taskCounter = 1;
        for (const act of atividades) {
            const taskId = `TASK-${instanceId.split('-')[1]}-${taskCounter}`;
            const targetSeconds = timeToTotalSeconds(act.tempo_previsto); // Função helper
            
            await conn.query(queryTarefa, [
                taskId,
                instanceId,
                act.proc_id,
                act.acao,
                'pendente',         // status inicial
                'countdown',        // time_mode (padrão)
                targetSeconds       // target_seconds
            ]);
            taskCounter++;
        }

        await conn.commit();
        conn.release();

        // 4. Retorna o ID do novo turno
        res.status(201).json({ instanceId: instanceId });

    } catch (error) {
        console.error('Erro em /api/turnos/iniciar:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

/**
 * @route POST /api/turnos/:id/encerrar
 * @desc Marca um turno como 'concluido'.
 */
app.post('/api/turnos/:id/encerrar', async (req, res) => {
    try {
        const { id } = req.params;
        const { shiftEnd } = req.body;

await pool.query(
            'UPDATE turnos SET status = ?, fim_turno = ? WHERE instance_id = ?',
            ['concluido', new Date(shiftEnd), id] // <-- ALTERADO AQUI
        );
        res.json({ message: 'Turno encerrado' });
    } catch (error) {
        console.error('Erro em /api/turnos/:id/encerrar:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

/**
 * @route POST /api/tarefa/:id/atualizar-status
 * @desc Atualiza o status e o runtime de uma tarefa (usado para PAUSE).
 */
app.post('/api/tarefa/:id/atualizar-status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, runtimeSeconds } = req.body;

        await pool.query(
            'UPDATE tarefas_execucao SET status = ?, runtime_seconds = ? WHERE task_id = ?',
            [status, runtimeSeconds, id]
        );
        res.json({ message: 'Status atualizado' });
    } catch (error) {
        console.error('Erro em /api/tarefa/:id/atualizar-status:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

/**
 * @route POST /api/tarefa/:id/completar
 * @desc Completa uma tarefa (SUCESSO ou FALHA) e salva evidências.
 */
app.post('/api/tarefa/:id/completar', async (req, res) => {
    try {
        const { id } = req.params;
        const { success, operatorTask, observation, completedAt, runtimeSeconds, photos } = req.body;

        const conn = await pool.getConnection();
        await conn.beginTransaction();

        // 1. Atualiza a tarefa principal
        await conn.query(
`UPDATE tarefas_execucao 
             SET status = ?, success = ?, operador_tarefa = ?, observacao = ?, 
                 completed = TRUE, completed_at = ?, runtime_seconds = ?
             WHERE task_id = ?`,
            [
                success ? 'concluido' : 'falha',
                success,
                operatorTask,
                observation,
                new Date(completedAt), // <-- ALTERADO AQUI
                runtimeSeconds,
                id
            ]
        );
        
        // 2. Deleta fotos antigas (caso esteja completando novamente após reiniciar)
        await conn.query('DELETE FROM evidencias_fotos WHERE task_id = ?', [id]);
        
        // 3. Salva as novas fotos (evidências)
        for (let base64Img of photos) {
            await conn.query(
                'INSERT INTO evidencias_fotos (task_id, imagem_base64) VALUES (?, ?)',
                [id, base64Img]
            );
        }
        
        await conn.commit();
        conn.release();
        
        res.json({ success: true, message: 'Tarefa completada' });
        
    } catch (error) {
        console.error('Erro em /api/tarefa/:id/completar:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

/**
 * @route POST /api/tarefa/:id/reiniciar
 * @desc Reseta uma tarefa para o estado inicial.
 */
app.post('/api/tarefa/:id/reiniciar', async (req, res) => {
    try {
        const { id } = req.params;
        
        const conn = await pool.getConnection();
        await conn.beginTransaction();

        // 1. Reseta a tarefa
        await conn.query(
            `UPDATE tarefas_execucao 
             SET status = 'pendente', runtime_seconds = 0, operador_tarefa = NULL, 
                 observacao = NULL, completed = FALSE, completed_at = NULL, success = NULL
             WHERE task_id = ?`,
            [id]
        );
        
        // 2. Deleta as evidências associadas
        await conn.query('DELETE FROM evidencias_fotos WHERE task_id = ?', [id]);
        
        await conn.commit();
        conn.release();
        
        res.json({ success: true, message: 'Tarefa reiniciada' });
        
    } catch (error) {
        console.error('Erro em /api/tarefa/:id/reiniciar:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

/**
 * @route GET /api/relatorios
 * @desc Busca todos os turnos (para a aba de relatórios).
 */
app.get('/api/relatorios', async (req, res) => {
    try {
        // Busca todos os turnos, ordenados do mais novo para o mais antigo
        const [turnos] = await pool.query(
            'SELECT * FROM turnos ORDER BY inicio_turno DESC'
        );
        
        const turnosCamel = toCamelCase(turnos);

        // Para cada turno, precisamos contar as tarefas
        for (let turno of turnosCamel) {
            const [stats] = await pool.query(
                `SELECT COUNT(*) AS total, SUM(completed = TRUE) AS done 
                 FROM tarefas_execucao 
                 WHERE turno_instance_id = ?`,
                [turno.instanceId]
            );
            turno.tasksTotal = stats[0].total || 0;
            turno.tasksDone = stats[0].done || 0;
        }

        res.json(turnosCamel);

    } catch (error) {
        console.error('Erro em /api/relatorios:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

/**
 * @route GET /api/relatorio/:id
 * @desc Busca dados completos de UM turno (para o preview do PDF).
 */
app.get('/api/relatorio/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Encontra o turno
        const [turnos] = await pool.query('SELECT * FROM turnos WHERE instance_id = ?', [id]);
        
        if (turnos.length === 0) {
            return res.status(404).json({ error: 'Relatório não encontrado' });
        }
        
        const turno = toCamelCase(turnos)[0];
        
        // 2. Busca as tarefas
        const [tarefas] = await pool.query(
            'SELECT * FROM tarefas_execucao WHERE turno_instance_id = ? ORDER BY task_id', 
            [turno.instanceId]
        );
        const tarefasCamel = toCamelCase(tarefas);

        // 3. Busca as fotos de CADA tarefa
        for (let tarefa of tarefasCamel) {
            const [fotos] = await pool.query(
                'SELECT imagem_base64 AS base64 FROM evidencias_fotos WHERE task_id = ?', 
                [tarefa.taskId]
            );
            tarefa.photos = fotos.map(f => f.base64); 
            
            // [Ajuste]: O frontend espera os nomes de colunas do Excel
            // Vamos adicionar eles aqui para o relatório funcionar sem refatorar o HTML
            const [modelo] = await pool.query(
                'SELECT acao, criterios_aceitacao, proc_id FROM atividades_importadas WHERE proc_id = ?',
                [tarefa.procId]
            );
            if(modelo.length > 0) {
                tarefa['Event / Action'] = modelo[0].acao;
                tarefa['Key Acceptance Criteria'] = modelo[0].criterios_aceitacao;
                tarefa['Proc. ID'] = modelo[0].proc_id;
            }
        }
        
        turno.tasks = tarefasCamel;
        res.json(turno);

    } catch (error) {
        console.error('Erro em /api/relatorio/:id:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});


// ------ 🚀 FIM DAS ROTAS DA API 🚀 ------

// Função helper (copiada do seu script.js)
function timeToTotalSeconds(timeStr) {
    if (!timeStr) return 0; // Retorna 0 se for nulo

    // Usa Regex para encontrar todos os pares "HH:MM" no texto
    const matches = timeStr.match(/(\d{2}):(\d{2})/g);

    // Se não encontrar nenhum (ex: "–"), retorna 0
    if (!matches) return 0;

    // Pega o último par encontrado (ex: "00:30" de "T + 00:00–00:30")
    const lastTimeStr = matches[matches.length - 1]; 
    const parts = lastTimeStr.split(':').map(p => parseInt(p, 10));

    if (parts.length === 2) {
        const hours = parts[0];
        const minutes = parts[1];
        const totalSeconds = (hours * 3600) + (minutes * 60);

        // Garante que o resultado nunca seja NaN
        return isNaN(totalSeconds) ? 0 : totalSeconds;
    }

    return 0; // Retorno padrão
}

// Inicia o servidor
app.listen(port, () => {
    console.log(`🚀 Backend DITL rodando em http://localhost:${port}`);
});