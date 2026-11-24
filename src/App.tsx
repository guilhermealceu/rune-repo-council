import React, { useState, useRef, useEffect } from 'react';
import { Github, Server, Play, CheckCircle, Loader2, AlertCircle, ShieldAlert, Code2, Network, Info, UserCheck, Wrench, Eye, Terminal, TestTube, Zap, History, Trash2, Target, Layers, FileText, XCircle, Copy, Code, LifeBuoy, ListTodo, Bug, Activity } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion } from 'framer-motion';

const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_MODELS = [GROQ_MODEL, 'openai/gpt-oss-20b'];
const migrateModel = (model: string) => GROQ_MODELS.includes(model) ? model : GROQ_MODEL;

type AgentType = string;

interface AgentConfig {
  id: string;
  type: AgentType;
  label: string;
  systemPrompt: string;
  model: string;
  active: boolean;
  iconName: string;
}

interface AgentState {
  status: 'idle' | 'running' | 'done' | 'error';
  report: string;
  statusMessage?: string;
}

interface HistoryEntry {
  id: string;
  date: string;
  repoUrl: string;
  agents: Record<AgentType, AgentState>;
}

const extractCodeBlocks = (text: string) => {
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  const blocks = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ language: match[1] || 'text', code: match[2].trim() });
  }
  return blocks;
};

export default function App() {
  const [repoUrl, setRepoUrl] = useState(() => localStorage.getItem('repo_council_repo_url') || 'https://github.com/facebook/react');
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem('repo_council_github_token') || '');
  const [simpleTask, setSimpleTask] = useState(false);
  const [taskDescription, setTaskDescription] = useState('');
  
  useEffect(() => {
    localStorage.setItem('repo_council_repo_url', repoUrl);
  }, [repoUrl]);

  useEffect(() => {
    localStorage.setItem('repo_council_github_token', githubToken);
  }, [githubToken]);


  
  const [globalStatus, setGlobalStatus] = useState<'idle' | 'fetching' | 'analyzing' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<AgentType | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const [useCache, setUseCache] = useState(true);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedAgentReport, setSelectedAgentReport] = useState<AgentType | null>(null);
  const [analyzedFiles, setAnalyzedFiles] = useState<{path: string, size: number}[]>([]);
  const [activeModalTab, setActiveModalTab] = useState<'report' | 'context' | 'code'>('report');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [projectMemory, setProjectMemory] = useState<string>('');
  const [showAgentEditor, setShowAgentEditor] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [activeAgents, setActiveAgents] = useState<AgentType[]>([]);
  const [groqStatus, setGroqStatus] = useState<{ status: 'online' | 'offline', responseTime: number | null }>({ status: 'offline', responseTime: null });
  const [projectOverviews, setProjectOverviews] = useState<Record<AgentType, string>>({});

  const checkGroq = async (signal?: AbortSignal) => {
    const start = Date.now();
    try {
      const res = await fetch('/api/llm/status', { signal });
      if (!res.ok) throw new Error('Falha ao verificar Groq.');
      const data = await res.json();
      setAvailableModels(data.models || []);
      setGroqStatus({ status: data.configured ? 'online' : 'offline', responseTime: Date.now() - start });
      return data.configured;
    } catch (error) {
      if (signal?.aborted) throw error;
      setGroqStatus({ status: 'offline', responseTime: null });
      return false;
    }
  };

  useEffect(() => { checkGroq(); }, []);

  const defaultExpertConfigs: AgentConfig[] = [
    { id: 'planner', type: 'planner', label: 'PLANNER', iconName: 'Target', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Planejador de Tarefas e Especialista em Localização de Código. Sua função é analisar a lista de arquivos e o objetivo da tarefa para identificar os arquivos mais relevantes.\n\nREGRAS CRÍTICAS:\n1. Alterações de CONTEÚDO (textos, anos, nomes, labels) estão quase sempre em arquivos .tsx, .jsx, .js ou .html. NUNCA sugira arquivos .css para mudar textos.\n2. Se a tarefa for simples (ex: mudar um ano no rodapé), foque apenas nos arquivos de UI (App.tsx, Footer.tsx, etc).\n3. Não invente complexidade. Se o arquivo parece óbvio, é ele.\n4. Sua análise deve ser um guia direto: "Arquivo X: contém o texto Y que deve ser alterado para Z".' },
    { id: 'arch', type: 'arch', label: 'ARCH', iconName: 'Network', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Arquiteto de Sistemas Sênior. Sua tarefa é avaliar a estrutura do repositório e padrões de projeto. Pense de forma holística: como uma mudança em um arquivo afeta o restante do sistema? Identifique dependências e riscos estruturais. \n\nREGRA DE CONCISÃO: Se a tarefa for trivial (ex: mudar um texto, cor ou label), responda apenas: "Análise dispensada: Tarefa sem impacto arquitetural." Não gere textos longos desnecessários.' },
    { id: 'dev', type: 'dev', label: 'DEV', iconName: 'Code2', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Especialista em Desenvolvimento Sênior. Analise o código focando em qualidade e bugs. Não sugira apenas novos arquivos; pense em como modificar os existentes de forma coesa. \n\nREGRA DE CONCISÃO: Se a tarefa for trivial (ex: mudar um texto ou label), responda apenas: "Análise dispensada: Alteração simples de UI/Texto." Não gere textos longos desnecessários.' },
    { id: 'sec', type: 'sec', label: 'SEC', iconName: 'ShieldAlert', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Especialista em Segurança da Informação (AppSec). Analise o código em busca de vulnerabilidades. \n\nREGRA DE CONCISÃO: Se a tarefa for trivial (ex: mudar um texto ou label), responda apenas: "Análise dispensada: Sem riscos de segurança identificados para esta alteração." Não gere textos longos desnecessários.' },
    { id: 'perf', type: 'perf', label: 'PERF', iconName: 'Zap', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Engenheiro de Performance. Analise gargalos e eficiência. \n\nREGRA DE CONCISÃO: Se a tarefa for trivial (ex: mudar um texto ou label), responda apenas: "Análise dispensada: Sem impacto em performance." Não gere textos longos desnecessários.' },
    { id: 'qa', type: 'qa', label: 'QA', iconName: 'TestTube', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Especialista em Quality Assurance (QA). Analise a testabilidade. \n\nREGRA DE CONCISÃO: Se a tarefa for trivial (ex: mudar um texto ou label), responda apenas: "Análise dispensada: Alteração de baixo risco, testes unitários simples bastam." Não gere textos longos desnecessários.' },
    { id: 'devops', type: 'devops', label: 'DEVOPS', iconName: 'Terminal', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Engenheiro DevOps Sênior. Analise CI/CD e infraestrutura. \n\nREGRA DE CONCISÃO: Se a tarefa for trivial (ex: mudar um texto ou label), responda apenas: "Análise dispensada: Sem impacto em infraestrutura ou deploy." Não gere textos longos desnecessários.' },
  ];

  const [expertConfigs, setExpertConfigs] = useState<AgentConfig[]>(() => {
    const saved = localStorage.getItem('agent_configs_experts') || localStorage.getItem('agent_config_experts');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Migração: garante que todos os agentes tenham a propriedade 'model'
      return parsed.map((agent: any) => ({
        ...agent,
        model: migrateModel(agent.model)
      }));
    }
    return defaultExpertConfigs;
  });

  const [techLeadConfig, setTechLeadConfig] = useState<AgentConfig>(() => {
    const saved = localStorage.getItem('agent_config_techlead');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...parsed, model: migrateModel(parsed.model) };
    }
    return { id: 'techLead', type: 'techLead', label: 'TECH LEAD', iconName: 'UserCheck', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Tech Lead experiente. Sua função é validar recomendações técnicas e criar um plano de ação HOLÍSTICO e INTEGRADO. Não aceite soluções isoladas; garanta que o plano cubra TODOS os arquivos afetados. Priorize a modificação de arquivos existentes para manter a coesão do sistema antes de sugerir a criação de novos arquivos.' };
  });

  const [seniorDevConfig, setSeniorDevConfig] = useState<AgentConfig>(() => {
    const saved = localStorage.getItem('agent_config_seniordev');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...parsed, model: migrateModel(parsed.model) };
    }
    return { id: 'seniorDev', type: 'seniorDev', label: 'SENIOR DEV', iconName: 'Wrench', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Desenvolvedor Sênior de elite. Sua única função é EXECUTAR o código. Não faça análises, não dê explicações, não faça observações. Vá direto ao código.\n\nREGRAS ABSOLUTAS:\n1. NÃO FAÇA ANÁLISE OU OBSERVAÇÕES. Comece sua resposta diretamente com "### caminho/do/arquivo.ext".\n2. Forneça o conteúdo COMPLETO do arquivo. NUNCA use "// ..." ou comentários para omitir partes.\n3. Envie apenas UM arquivo por vez.\n4. Se tudo estiver pronto, responda apenas "CONCLUIDO".' };
  });

  const [reviewerConfig, setReviewerConfig] = useState<AgentConfig>(() => {
    const saved = localStorage.getItem('agent_config_reviewer');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...parsed, model: migrateModel(parsed.model) };
    }
    return { id: 'reviewer', type: 'reviewer', label: 'REVIEWER', iconName: 'Eye', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Revisor de Código implacável. Sua função é garantir que o Dev Sênior entregou o arquivo COMPLETO e SEM CONVERSA FIADA.\n\nREGRAS DE REJEIÇÃO:\n1. O Dev incluiu observações, análises ou conversas antes ou depois do código? REJEITE.\n2. O Dev omitiu partes do código com "// ..." ou similar? REJEITE.\n3. O código está incompleto ou quebra o sistema? REJEITE.\n\nSe houver qualquer erro ou conversa, responda "REJEITADO" e o motivo curto. Se estiver perfeito, responda APENAS "APROVADO". Seja extremamente direto.' };
  });

  const [debuggerConfig, setDebuggerConfig] = useState<AgentConfig>(() => {
    const saved = localStorage.getItem('agent_config_debugger');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...parsed, model: migrateModel(parsed.model) };
    }
    return { id: 'debugger', type: 'debugger', label: 'DEBUGGER', iconName: 'Bug', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Especialista em Debugging e SRE. Sua função é analisar erros do Groq ou do sistema. Para limites de uso, respeite a espera e reduza o contexto. Nunca recomende modelos pagos ou migração automática para Ollama.' };
  });

  useEffect(() => {
    localStorage.setItem('agent_configs_experts', JSON.stringify(expertConfigs));
  }, [expertConfigs]);

  useEffect(() => {
    localStorage.setItem('agent_config_techlead', JSON.stringify(techLeadConfig));
  }, [techLeadConfig]);

  useEffect(() => {
    localStorage.setItem('agent_config_seniordev', JSON.stringify(seniorDevConfig));
  }, [seniorDevConfig]);

  useEffect(() => {
    localStorage.setItem('agent_config_reviewer', JSON.stringify(reviewerConfig));
  }, [reviewerConfig]);

  useEffect(() => {
    localStorage.setItem('agent_config_debugger', JSON.stringify(debuggerConfig));
  }, [debuggerConfig]);

  useEffect(() => {
    if (selectedAgentReport) setActiveModalTab('report');
  }, [selectedAgentReport]);

  // Load project memory when repo changes
  useEffect(() => {
    const memory = localStorage.getItem(`memory_${repoUrl}`);
    if (memory) setProjectMemory(memory);
    else setProjectMemory('');
  }, [repoUrl]);

  const initialAgentsState: Record<AgentType, AgentState> = {
    techLead: { status: 'idle', report: '' },
    seniorDev: { status: 'idle', report: '' },
    reviewer: { status: 'idle', report: '' },
    debugger: { status: 'idle', report: '' }
  };

  // Dynamically add experts to initial state
  expertConfigs.forEach(config => {
    initialAgentsState[config.type] = { status: 'idle', report: '', statusMessage: '' };
  });

  const [agents, setAgents] = useState<Record<AgentType, AgentState>>(initialAgentsState);

  useEffect(() => {
    const saved = localStorage.getItem('repo_council_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  const saveToHistory = (repo: string, finalAgents: Record<AgentType, AgentState>) => {
    const newEntry: HistoryEntry = {
      id: Date.now().toString(),
      date: new Date().toLocaleString(),
      repoUrl: repo,
      agents: finalAgents
    };
    setHistory(prev => {
      const updated = [newEntry, ...prev.filter(h => h.repoUrl !== repo)].slice(0, 10); // Keep last 10
      localStorage.setItem('repo_council_history', JSON.stringify(updated));
      return updated;
    });
  };

  const loadHistoryEntry = (entry: HistoryEntry) => {
    setRepoUrl(entry.repoUrl);
    setAgents(entry.agents);
    setGlobalStatus('done');
    setActiveAgent(null);
    setShowHistory(false);
  };
  
  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('repo_council_history');
  };

  const fetchRepo = async (owner: string, repo: string, token: string, signal?: AbortSignal) => {
    const headers: Record<string, string> = token ? { Authorization: `token ${token}` } : {};
    
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers, signal });
    if (!repoRes.ok) throw new Error(`Falha ao buscar repositório: ${repoRes.statusText}`);
    const repoData = await repoRes.json();
    const branch = repoData.default_branch;

    const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers, signal });
    if (!treeRes.ok) throw new Error(`Falha ao buscar árvore de arquivos: ${treeRes.statusText}`);
    const treeData = await treeRes.json();

    if (!treeData || !treeData.tree || !Array.isArray(treeData.tree)) {
      throw new Error("Estrutura do repositório inválida ou vazia.");
    }

    const validExts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.java', '.rb', '.php', '.json', '.md', '.html', '.css'];
    const allFiles = treeData.tree.filter((f: any) => 
      f.type === 'blob' && 
      validExts.some(ext => f.path.endsWith(ext)) && 
      !f.path.includes('node_modules') && 
      !f.path.includes('dist') && 
      !f.path.includes('build') && 
      !f.path.includes('.git')
    );

    // Pegamos os 15 arquivos mais importantes inicialmente (aumentado de 10)
    // Amostra menor para caber no orçamento de tokens do plano gratuito.
    const topFiles = allFiles.slice(0, simpleTask ? 15 : 3);
    let codebase = '';
    const fetchedFiles: {path: string, size: number}[] = [];
    
    const fileHeaders: Record<string, string> = {
      ...headers,
      Accept: 'application/vnd.github.v3.raw'
    };

    for (const file of topFiles) {
      if (signal?.aborted) throw new Error("Busca cancelada pelo usuário.");
      
      setGlobalStatus('fetching');
      console.log(`Buscando arquivo: ${file.path}`);
      
      const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${branch}`, { headers: fileHeaders, signal });
      if (fileRes.ok) {
        const content = await fileRes.text();
        codebase += `\n\n--- ARQUIVO: ${file.path} ---\n${content.substring(0, 4000)}`;
        fetchedFiles.push({ path: file.path, size: content.length });
      }
    }
    setAnalyzedFiles(fetchedFiles);
    return { codebase, files: fetchedFiles, allFiles, branch };
  };

  const fetchProjectOverviews = async (repoName: string) => {
    const overviews: Record<AgentType, string> = {};
    const agentsToFetch = ['arch', 'dev', 'sec', 'perf', 'qa', 'devops'];
    
    for (const agentType of agentsToFetch) {
      try {
        const res = await fetch(`/api/get-project-overview?agentType=${agentType}&repoName=${repoName}`);
        if (res.ok) {
          const data = await res.json();
          if (data.overview) {
            overviews[agentType] = data.overview;
          }
        }
      } catch (e) {
        console.warn(`Falha ao buscar overview para ${agentType}`, e);
      }
    }
    setProjectOverviews(overviews);
    return overviews;
  };

  const saveProjectOverview = async (agentType: string, overview: string, repoName: string) => {
    try {
      await fetch('/api/save-project-overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentType, overview, repoName })
      });
    } catch (e) {
      console.warn(`Falha ao salvar overview para ${agentType}`, e);
    }
  };

  const askModel = async (system: string, prompt: string, type: AgentType, modelOverride?: string, signal?: AbortSignal): Promise<string> => {
    const config = [techLeadConfig, seniorDevConfig, reviewerConfig, debuggerConfig, ...expertConfigs].find(c => c.type === type);
    const model = modelOverride || config?.model || GROQ_MODEL;
    setAgents(prev => ({ ...prev, [type]: { ...prev[type], status: 'running', statusMessage: simpleTask ? 'Consultando Ollama (tarefa simples)...' : 'Consultando Groq; aguardando cota gratuita...' } }));
    setActiveAgent(type);
    try {
      const res = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, simpleTask, maxTokens: type === 'seniorDev' ? 2500 : 1500, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
        signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao consultar modelo.');
      setAgents(prev => ({ ...prev, [type]: { status: 'done', report: data.content } }));
      return data.content;
    } catch (err: any) {
      const cancelled = signal?.aborted || err.name === 'AbortError';
      setAgents(prev => ({ ...prev, [type]: { status: cancelled ? 'idle' : 'error', report: cancelled ? 'Cancelado.' : `Erro: ${err.message}` } }));
      throw err;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setGlobalStatus('idle');
      setActiveAgent(null);
      setError("Operação cancelada pelo usuário.");
    }
  };

  const saveFileLocally = async (fileName: string, content: string) => {
    try {
      await fetch('/api/save-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, content, repoName: repoUrl.split('/').pop() })
      });
    } catch (err) {
      console.error("Erro ao salvar arquivo localmente:", err);
    }
  };

  const saveReportLocally = async (agentType: string, report: string) => {
    try {
      await fetch('/api/save-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentType, report, repoName: repoUrl.split('/').pop() })
      });
    } catch (err) {
      console.error("Erro ao salvar relatório localmente:", err);
    }
  };

  const handleStart = async () => {
    setError(null);
    
    if (useCache) {
      const cached = history.find(h => h.repoUrl === repoUrl);
      if (cached) {
        loadHistoryEntry(cached);
        return;
      }
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    setGlobalStatus('fetching');
    setActiveAgent(null);
    setAgents(initialAgentsState);

    try {
      if (!simpleTask && !await checkGroq(signal)) {
        throw new Error('Configure GROQ_API_KEY em .env.local e reinicie o servidor.');
      }
      setAgents(prev => ({ ...prev, debugger: { status: 'done', report: simpleTask ? 'Ollama habilitado explicitamente para esta tarefa simples.' : 'Groq GPT-OSS configurado. Requisições respeitam a cota gratuita; Ollama desativado nesta análise.' } }));

      // 2. Fetch Repo
      setGlobalStatus('fetching');
      setActiveAgents([]);

      let owner = '', repo = '';
      try {
        const urlObj = new URL(repoUrl);
        const parts = urlObj.pathname.split('/').filter(Boolean);
        owner = parts[0];
        repo = parts[1];
        if (!owner || !repo) throw new Error("URL inválida");
      } catch (e) {
        throw new Error("Formato de URL do GitHub inválido. Use https://github.com/usuario/repositorio");
      }

      const repoData = await fetchRepo(owner, repo, githubToken, signal);
      
      if (!repoData || !repoData.codebase) {
        throw new Error("Nenhum código fonte válido encontrado no repositório.");
      }

      const { codebase: initialCodebase, files: fetchedFiles, allFiles, branch } = repoData;
      let codebase = initialCodebase;

      // Fetch Cached Overviews
      const cachedOverviews = useCache ? await fetchProjectOverviews(repo) : {};

      setGlobalStatus('analyzing');

      // 3. PLANNER with Semantic Search & Dynamic Reading
      setActiveAgents(['planner']);
      setAgents(prev => ({ ...prev, planner: { status: 'running', report: 'Iniciando busca semântica e planejamento...' } }));

      // Extract keywords from task description for grep
      const keywords = taskDescription.split(' ').filter(w => w.length > 3).slice(0, 5);
      let grepResults = "";
      if (keywords.length > 0) {
        try {
          const res = await fetch('/api/grep', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords })
          });
          if (res.ok) {
            const data = await res.json();
            grepResults = data.stdout ? `\n\nRESULTADOS DA BUSCA SEMÂNTICA (grep):\n${data.stdout}` : "";
          }
        } catch (e) {
          console.warn("Grep falhou ou não encontrou resultados", e);
        }
      }

      const promptBase = `Analise o seguinte código fonte do repositório ${owner}/${repo}:\n\n${codebase}${grepResults}`;
      
      const taskContext = taskDescription.trim() 
        ? `\n\nOBJETIVO ESPECÍFICO DA TAREFA: "${taskDescription}".` 
        : '';

      // 1. Planner Agent
      let plannerOutput = '';
      const plannerConfig = expertConfigs.find(c => c.id === 'planner');
      if (plannerConfig && plannerConfig.active) {
        const fileList = allFiles.map((f: any) => f.path).join(', ');
        const plannerPrompt = `${plannerConfig.systemPrompt}
        
Lista de TODOS os arquivos do projeto: ${fileList.substring(0, 10000)}

Sua tarefa:
1. Analise o objetivo e a lista de arquivos.
2. Se você precisar ler o conteúdo de algum arquivo que NÃO está no snapshot acima para planejar melhor, liste-os no final da sua resposta no formato: [READ: caminho/do/arquivo.ts].
3. Crie o plano de ação.`;
        
        plannerOutput = await askModel(plannerPrompt, promptBase, 'planner', undefined, signal);
        
        // Dynamic Reading: Se o planner pediu arquivos, vamos buscar
        const readMatches = plannerOutput.match(/\[READ:\s*([^\]]+)\]/g);
        if (readMatches) {
          setAgents(prev => ({ ...prev, planner: { ...prev.planner, statusMessage: `Lendo arquivos solicitados pelo Planner...` } }));
          for (const match of readMatches) {
            const filePath = match.replace('[READ:', '').replace(']', '').trim();
            try {
              const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`, { 
                headers: githubToken ? { Authorization: `token ${githubToken}`, Accept: 'application/vnd.github.v3.raw' } : { Accept: 'application/vnd.github.v3.raw' }, 
                signal 
              });
              if (fileRes.ok) {
                const content = await fileRes.text();
                codebase += `\n\n--- ARQUIVO SOLICITADO: ${filePath} ---\n${content.substring(0, 5000)}`;
                console.log(`Arquivo extra lido: ${filePath}`);
              }
            } catch (e) {
              console.warn(`Falha ao ler arquivo dinâmico: ${filePath}`, e);
            }
          }
        }
        
        setAgents(prev => ({ ...prev, planner: { status: 'done', report: plannerOutput } }));
      }

      // 4. Parallel Experts (Arch, Dev, Sec, Perf, QA, DevOps)
      const activeExperts = expertConfigs.filter(c => c.active && c.id !== 'planner');
      setActiveAgents(activeExperts.map(c => c.type));
      
      activeExperts.forEach(c => {
        setAgents(prev => ({ ...prev, [c.type]: { status: 'running', report: 'Analisando em paralelo...' } }));
      });

      // Redefine promptBase with updated codebase (including dynamic reads)
      const finalPromptBase = `Analise o seguinte código fonte do repositório ${owner}/${repo}:\n\n${codebase}${grepResults}`;

      const expertPromises = activeExperts.map(async (config) => {
        const hasCache = !!cachedOverviews[config.type];
        
        let systemPrompt = config.systemPrompt;
        let userPrompt = finalPromptBase;

        if (hasCache) {
          systemPrompt += `\n\nCONTEXTO DO PROJETO (CACHE):\n${cachedOverviews[config.type]}\n\nUse este contexto para agilizar sua análise. Foque APENAS no impacto da nova tarefa.`;
          userPrompt = `${taskContext}\n\nAnalise o impacto desta tarefa específica no projeto acima descrito.`;
        } else {
          systemPrompt += `\n\nSua resposta DEVE ser dividida em duas partes:\n1. [PROJECT_OVERVIEW]: Uma análise profunda e estrutural do projeto como um todo (arquitetura, padrões, fluxos principais).\n2. [TASK_ANALYSIS]: O impacto específico da tarefa solicitada.\n\nUse as tags [PROJECT_OVERVIEW] e [TASK_ANALYSIS] claramente.`;
          userPrompt = `${finalPromptBase}${taskContext}`;
        }

        const fullSystemPrompt = `${systemPrompt} ${plannerOutput ? `\n\nO Planejador sugeriu focar em: ${plannerOutput}` : ''} Responda EXCLUSIVAMENTE em Português do Brasil e use Markdown.`;
        
        const res = await askModel(fullSystemPrompt, userPrompt, config.type, undefined, signal);
        
        let finalReport = res;
        if (!hasCache) {
          const overviewMatch = res.match(/\[PROJECT_OVERVIEW\]([\s\S]*?)\[TASK_ANALYSIS\]/);
          const analysisMatch = res.match(/\[TASK_ANALYSIS\]([\s\S]*)$/);
          
          if (overviewMatch && analysisMatch) {
            const overview = overviewMatch[1].trim();
            const analysis = analysisMatch[1].trim();
            saveProjectOverview(config.type, overview, repo);
            finalReport = `### ANÁLISE DO PROJETO (SALVA EM CACHE)\n${overview}\n\n### IMPACTO DA TAREFA\n${analysis}`;
          }
        }

        saveReportLocally(config.type, finalReport);
        setAgents(prev => ({ ...prev, [config.type]: { status: 'done', report: finalReport } }));
        return { type: config.type, report: finalReport };
      });

      const expertReports = await Promise.all(expertPromises);
      const expertResults: Record<string, string> = {};
      expertReports.forEach(r => { expertResults[r.type] = r.report; });

      // 2. Tech Lead Agent
      if (signal.aborted) throw new Error("Execução cancelada.");
      const techLeadPrompt = `${techLeadConfig.systemPrompt}

OBJETIVO DA TAREFA: "${taskDescription || 'Análise Geral do Repositório'}"

Você recebeu os relatórios de ${activeExperts.length} especialistas.
Sua tarefa é avaliar as recomendações deles, filtrar o que faz sentido para o projeto e criar um Plano de Ação consolidado, priorizado e DETALHADO para o Desenvolvedor Sênior executar.
${taskDescription.trim() ? `\nLEMBRE-SE: O objetivo principal é "${taskDescription}". Descarte sugestões dos especialistas que fujam deste escopo ou sejam complexas demais para a tarefa solicitada.\n` : ''}

MEMÓRIA DO PROJETO (Tarefas já realizadas anteriormente neste repositório):
${projectMemory || 'Nenhuma tarefa anterior registrada. Esta é a primeira.'}

REGRAS DE OURO PARA O PLANO:
1. NUNCA quebre funcionalidades existentes (Autenticação, Banco de Dados, UI Mobile).
2. Mantenha a stack atual (ex: se o projeto usa ES Modules 'import', não sugira CommonJS 'require').
3. NÃO sugira usar dados estáticos (mock data). O plano deve integrar com o banco de dados real.
4. Seja cirúrgico: altere apenas o necessário para cumprir o objetivo. Dê preferência absoluta a modificar arquivos existentes.
5. Leve em consideração a Memória do Projeto para não refazer o que já foi feito.
6. Garanta que o plano seja HOLÍSTICO: se mudar o CSS, verifique se o HTML/JS precisa de ajustes correspondentes.
7. O plano deve listar EXATAMENTE quais arquivos devem ser modificados e o que deve ser feito em cada um.

Relatórios dos Especialistas:
${Object.entries(expertResults).map(([type, report]) => `--- AGENTE: ${type} ---\n${report}`).join('\n\n')}

Crie o Plano de Ação consolidado EXCLUSIVAMENTE em Português do Brasil usando Markdown.`;

      const techLeadReport = await askModel(
        "Você é um Tech Lead experiente. Responda EXCLUSIVAMENTE em Português do Brasil.",
        techLeadPrompt,
        'techLead',
        undefined,
        signal
      );
      saveReportLocally('techLead', techLeadReport);

      // 3. Senior Dev & Reviewer Agents (File by File Loop)
      let accumulatedDevReport = '';
      let accumulatedReviewerReport = '';
      let completedFiles: string[] = [];
      let executionLoopCount = 0;
      const MAX_FILES = 5; // Limite de segurança para não ficar infinito
      let isFinished = false;
      let isApprovedGlobal = false; // Status global de aprovação

      while (!isFinished && executionLoopCount < MAX_FILES) {
        if (signal.aborted) throw new Error("Execução cancelada.");
        executionLoopCount++;
        let fileApproved = false;
        let fileDevLoopCount = 0;
        let currentFileFeedback = '';
        let lastDevResponse = '';

        while (!fileApproved && fileDevLoopCount < 2) {
          if (signal.aborted) throw new Error("Execução cancelada.");
          fileDevLoopCount++;
          
          const seniorDevPrompt = `${seniorDevConfig.systemPrompt}

OBJETIVO DA TAREFA: "${taskDescription || 'Análise Geral'}"

O Tech Lead te passou o seguinte Plano de Ação:
${techLeadReport}

CONTEXTO DOS ESPECIALISTAS (Use isso para entender o "porquê" das mudanças):
${Object.entries(expertResults).map(([type, report]) => `--- ${type}: ${report.substring(0, 500)}...`).join('\n')}

MEMÓRIA DO PROJETO (Contexto de tarefas passadas):
${projectMemory || 'Nenhuma tarefa anterior registrada.'}

Arquivos já concluídos nesta tarefa: ${completedFiles.length > 0 ? completedFiles.join(', ') : 'Nenhum'}

Aqui está o código atual do repositório para contexto:
${codebase.substring(0, 15000)}

${currentFileFeedback ? `O Revisor REJEITOU sua última tentativa para o arquivo atual com este feedback:\n${currentFileFeedback}\nCorrija o arquivo e mande novamente.` : `Sua tarefa:
1. Escolha APENAS UM (1) arquivo que ainda precisa ser criado ou modificado.
2. Dê preferência absoluta a modificar arquivos existentes.
3. Se TODOS os arquivos necessários já foram concluídos, responda EXATAMENTE com a palavra "CONCLUIDO" e nada mais.
4. Caso contrário, gere o código COMPLETO do arquivo escolhido.`}

REGRAS DE OURO (MUITO IMPORTANTE):
1. NÃO FAÇA ANÁLISE. NÃO DÊ EXPLICAÇÕES. NÃO FAÇA OBSERVAÇÕES.
2. Comece sua resposta IMEDIATAMENTE com "### caminho/do/arquivo.ext".
3. Retorne o CÓDIGO COMPLETO do arquivo, do início ao fim. Sem omissões.
4. NUNCA use comentários como "// ... código existente". Eu preciso do arquivo inteiro.
5. Envolva o código em um bloco Markdown com a linguagem correta.
`;

          setActiveAgents(['seniorDev']);
          setAgents(prev => ({ 
            ...prev, 
            seniorDev: { 
              ...prev.seniorDev, 
              status: 'running', 
              statusMessage: `Trabalhando no arquivo ${executionLoopCount} (Tentativa ${fileDevLoopCount})...\nArquivos prontos: ${completedFiles.join(', ')}` 
            } 
          }));

          lastDevResponse = await askModel(
            "Você é um Desenvolvedor Sênior de elite. Retorne apenas UM arquivo por vez, completo.",
            seniorDevPrompt,
            'seniorDev',
            undefined,
            signal
          );
          saveReportLocally('seniorDev', lastDevResponse);

          if (lastDevResponse.trim().toUpperCase().includes('CONCLUIDO') && lastDevResponse.length < 100) {
            isFinished = true;
            break;
          }

          // 4. Reviewer Agent (Revisando arquivo específico)
          if (signal.aborted) throw new Error("Execução cancelada.");
          setActiveAgents(['reviewer']);
          setAgents(prev => ({ 
            ...prev, 
            reviewer: { 
              ...prev.reviewer, 
              status: 'running', 
              statusMessage: `Revisando o arquivo ${executionLoopCount}...` 
            } 
          }));

          const reviewerPrompt = `${reviewerConfig.systemPrompt}

OBJETIVO DA TAREFA: "${taskDescription || 'Análise Geral'}"

O Dev Sênior gerou o seguinte arquivo para o plano:

Plano Original:
${techLeadReport}

Arquivo gerado pelo Dev:
${lastDevResponse}

Sua tarefa é revisar rigorosamente ESTE arquivo.
REGRAS DE REJEIÇÃO IMEDIATA (Responda REJEITADO se):
1. O Dev omitiu código usando "// ..." ou similar? (Ele DEVE fornecer o arquivo completo).
2. O Dev mandou MAIS DE UM arquivo? (Ele deve mandar apenas UM por vez).
3. O código quebra funcionalidades existentes ou usa sintaxe inventada?
4. O código cria um novo arquivo desnecessário quando poderia ter modificado um existente?

Se houver erro, responda começando com a palavra "REJEITADO" seguida do que precisa ser corrigido.
Se estiver perfeito, seguro e completo, responda começando com a palavra "APROVADO" seguida de seus comentários. Responda EXCLUSIVAMENTE em Português do Brasil.`;

          const reviewerResponse = await askModel(
            "Você é um Revisor de Código implacável. Você não deixa passar nenhum erro.",
            reviewerPrompt,
            'reviewer',
            undefined,
            signal
          );
          saveReportLocally('reviewer', reviewerResponse);

          const isApproved = reviewerResponse.toUpperCase().includes('APROVADO');
          const isRejected = reviewerResponse.toUpperCase().includes('REJEITADO');

          if (isApproved && !isRejected) {
            fileApproved = true;
            accumulatedReviewerReport += `\n\n### ✅ Revisão do Arquivo ${executionLoopCount} (APROVADO)\n${reviewerResponse}`;
            isApprovedGlobal = true; // Pelo menos um arquivo foi aprovado
            
            // Extrai nome do arquivo para salvar localmente
            const match = lastDevResponse.match(/###\s*(.+)/);
            const fileName = match ? match[1].trim() : `Arquivo_${executionLoopCount}.txt`;
            saveFileLocally(fileName, lastDevResponse);

            // Atualiza estado IMEDIATAMENTE para o usuário ver na aba "Código Gerado"
            accumulatedDevReport += `\n\n### ✅ Arquivo ${executionLoopCount}: ${fileName}\n${lastDevResponse}`;
            setAgents(prev => ({
              ...prev,
              seniorDev: { ...prev.seniorDev, report: accumulatedDevReport, statusMessage: `Arquivo ${fileName} APROVADO!` },
              reviewer: { ...prev.reviewer, report: accumulatedReviewerReport, statusMessage: `Arquivo ${fileName} APROVADO!` }
            }));
          } else {
            currentFileFeedback = reviewerResponse;
            // Mesmo se rejeitado, salvamos no histórico acumulado para o usuário ver o que aconteceu
            accumulatedDevReport += `\n\n### ❌ Tentativa Rejeitada (${executionLoopCount})\n${lastDevResponse}`;
            accumulatedReviewerReport += `\n\n### ❌ Revisão da Tentativa ${executionLoopCount} (REJEITADO)\n${reviewerResponse}`;
            
            setAgents(prev => ({
              ...prev,
              seniorDev: { ...prev.seniorDev, report: accumulatedDevReport, statusMessage: `Tentativa ${executionLoopCount} REJEITADA. Corrigindo...` },
              reviewer: { ...prev.reviewer, report: accumulatedReviewerReport, statusMessage: `Tentativa ${executionLoopCount} REJEITADA.` }
            }));
          }
        }

        if (isFinished) {
          break;
        }

        if (fileApproved) {
          const match = lastDevResponse.match(/###\s*(.+)/);
          const fileName = match ? match[1].trim() : `Arquivo ${executionLoopCount}`;
          if (!completedFiles.includes(fileName)) {
            completedFiles.push(fileName);
          }
        }
      }

      // Atualiza os relatórios finais e salva localmente
      setAgents(prev => {
        const finalAgents: Record<AgentType, AgentState> = {
          ...prev,
          seniorDev: { ...prev.seniorDev, status: 'done' as const, report: accumulatedDevReport || 'Nenhum arquivo modificado.' },
          reviewer: { ...prev.reviewer, status: 'done' as const, report: accumulatedReviewerReport || 'Revisão concluída.' }
        };
        saveReportLocally('seniorDev', finalAgents.seniorDev.report);
        saveReportLocally('reviewer', finalAgents.reviewer.report);
        return finalAgents;
      });

      if (isApprovedGlobal) {
        // Update Project Memory on success
        if (taskDescription.trim()) {
          const memoryEntry = `\n- [${new Date().toLocaleDateString()}] Tarefa concluída: ${taskDescription}`;
          const updatedMemory = projectMemory + memoryEntry;
          setProjectMemory(updatedMemory);
          localStorage.setItem(`memory_${repoUrl}`, updatedMemory);
        }
      }

      setActiveAgents([]);
      setGlobalStatus('done');
      abortControllerRef.current = null;
      
      // Save to history
      setAgents(currentAgents => {
        saveToHistory(repoUrl, currentAgents);
        return currentAgents;
      });

    } catch (err: any) {
      if (err.name === 'AbortError' || err.message.includes('cancelada')) {
        // Silently handle abort
      } else {
        setError(err.message);
      }
      setActiveAgents([]);
      setGlobalStatus('idle');
      abortControllerRef.current = null;
    }
  };

  const getIcon = (name: string) => {
    switch (name) {
      case 'Network': return <Network className="w-4 h-4" />;
      case 'Code2': return <Code2 className="w-4 h-4" />;
      case 'ShieldAlert': return <ShieldAlert className="w-4 h-4" />;
      case 'Zap': return <Zap className="w-4 h-4" />;
      case 'TestTube': return <TestTube className="w-4 h-4" />;
      case 'Terminal': return <Terminal className="w-4 h-4" />;
      case 'UserCheck': return <UserCheck className="w-4 h-4" />;
      case 'Wrench': return <Wrench className="w-4 h-4" />;
      case 'Eye': return <Eye className="w-4 h-4" />;
      case 'Bug': return <Bug className="w-4 h-4" />;
      case 'Target': return <Target className="w-4 h-4" />;
      default: return <Code2 className="w-4 h-4" />;
    }
  };

  const exportAllReports = () => {
    let content = `=== RUNE REPO COUNCIL EXPORT ===\n`;
    content += `Data: ${new Date().toLocaleString()}\n`;
    content += `Repo: ${repoUrl}\n`;
    content += `Tarefa: ${taskDescription || 'Análise Geral'}\n\n`;

    Object.entries(agents).forEach(([type, state]) => {
      if (state.report) {
        content += `\n\n=====================================================\n`;
        content += `--- AGENTE: ${type.toUpperCase()} ---\n`;
        content += `=====================================================\n\n`;
        content += state.report;
        content += `\n\n`;
      }
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repo_council_export_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderAgentNode = (type: AgentType, label: string, x: number, y: number, icon: React.ReactNode) => {
    const status = agents[type]?.status || 'idle';
    const isActive = activeAgents.includes(type);
    const report = agents[type]?.report || '';
    
    let colorClass = 'border-gray-700 bg-gray-800/50 text-gray-400';
    let glowClass = '';
    
    if (isActive) {
      colorClass = 'border-green-500 bg-green-500/20 text-green-300';
      glowClass = 'shadow-[0_0_15px_rgba(34,197,94,0.5)]';
    } else if (status === 'done') {
      colorClass = 'border-blue-500 bg-blue-500/10 text-blue-400';
    } else if (status === 'error') {
      colorClass = 'border-red-500 bg-red-500/10 text-red-400';
    }

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`absolute flex flex-col items-center justify-center w-16 h-16 rounded-xl border-2 backdrop-blur-sm transition-all duration-300 ${colorClass} ${glowClass} z-10 cursor-pointer hover:scale-105`}
        style={{ left: `calc(50% + ${x}px - 32px)`, top: `calc(50% + ${y}px - 32px)` }}
        onClick={() => setSelectedAgentReport(type)}
      >
        {status === 'running' && (
          <svg className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] pointer-events-none z-0">
            <rect
              x="2"
              y="2"
              width="calc(100% - 4px)"
              height="calc(100% - 4px)"
              rx="14"
              fill="none"
              stroke="rgba(34,197,94,0.2)"
              strokeWidth="2"
            />
            <motion.rect
              x="2"
              y="2"
              width="calc(100% - 4px)"
              height="calc(100% - 4px)"
              rx="14"
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
              strokeDasharray="15 300"
              strokeLinecap="round"
              initial={{ strokeDashoffset: 0 }}
              animate={{ strokeDashoffset: -315 }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
            />
          </svg>
        )}
        <div className="mb-1">{icon}</div>
        <span className="text-[10px] font-bold text-center leading-tight px-1">{label}</span>

        {/* Speech Bubble */}
        {(isActive || status === 'done') && report && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute -top-14 left-1/2 -translate-x-1/2 w-36 bg-[#1a1a1a] border border-gray-700 rounded-lg p-1.5 shadow-xl z-20 cursor-pointer hover:border-green-500/50 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedAgentReport(type);
            }}
          >
            <div className="text-[8px] text-gray-300 line-clamp-3 leading-tight font-mono break-words">
              {status === 'done' ? `${label}: Terminei por aqui.` : (agents[type].statusMessage || report.split('\n').filter(line => line.trim() !== '').slice(-3).join('\n') || 'Pensando...')}
            </div>
            {/* Triangle pointer */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-t-[8px] border-t-gray-700 border-r-[6px] border-r-transparent"></div>
            <div className="absolute -bottom-[6px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-t-[7px] border-t-[#1a1a1a] border-r-[5px] border-r-transparent"></div>
          </motion.div>
        )}
      </motion.div>
    );
  };

  const renderConnection = (x1: number, y1: number, x2: number, y2: number, active: boolean) => {
    return (
      <svg className="absolute left-1/2 top-1/2 overflow-visible pointer-events-none z-0">
        <motion.line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={active ? '#22c55e' : 'rgba(255,255,255,0.1)'}
          strokeWidth={active ? 2 : 1}
          strokeDasharray={active ? "5,5" : "none"}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5 }}
        />
        {active && (
          <motion.circle
            r="3"
            fill="#22c55e"
            initial={{ offsetDistance: "0%" }}
            animate={{ offsetDistance: "100%" }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
            style={{ offsetPath: `path("M ${x1} ${y1} L ${x2} ${y2}")` }}
          />
        )}
      </svg>
    );
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-200 font-sans selection:bg-blue-500/30">
      <header className="border-b border-white/10 bg-[#111] px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
            <Network className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Rune Repo Council</h1>
            <p className="text-xs text-gray-400">Orquestração Avançada de Agentes</p>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-80px)]">
        {/* Left Sidebar - Config */}
        <div className="lg:col-span-3 flex flex-col gap-6 h-full overflow-y-auto custom-scrollbar pr-2">
          <div className="bg-[#111] border border-white/10 rounded-xl p-5 shadow-xl shrink-0">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Server className="w-4 h-4" /> Configuração
            </h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-400">Cache de Análise</label>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setUseCache(!useCache)}
                    className={`text-[10px] px-2 py-1 rounded border transition-colors ${useCache ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`}
                  >
                    {useCache ? 'Ativado' : 'Desativado'}
                  </button>
                  <button 
                    onClick={() => {
                      setProjectOverviews({});
                      alert('Cache em memória limpo. Na próxima execução, os agentes farão uma nova análise completa do projeto.');
                    }}
                    className="text-[10px] px-2 py-1 rounded border bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors flex items-center gap-1"
                    title="Limpa o cache em memória. Os arquivos no disco permanecerão, mas os agentes serão forçados a reanalisar."
                  >
                    <Trash2 className="w-3 h-3" /> Limpar
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Repositório GitHub (URL)</label>
                <div className="relative">
                  <Github className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input 
                    type="text" 
                    value={repoUrl}
                    onChange={e => setRepoUrl(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-lg py-2 pl-9 pr-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    placeholder="https://github.com/owner/repo"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">GitHub Token (Opcional)</label>
                <input 
                  type="password" 
                  value={githubToken}
                  onChange={e => setGithubToken(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  placeholder="ghp_..."
                />
              </div>

              <div className="pt-4 border-t border-white/10">
                <label className="block text-xs font-medium text-gray-400 mb-1">Objetivo da Tarefa (Opcional)</label>
                <div className="relative">
                  <Target className="w-4 h-4 absolute left-3 top-3 text-gray-500" />
                  <textarea 
                    value={taskDescription}
                    onChange={e => setTaskDescription(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-lg py-2 pl-9 pr-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all min-h-[80px] resize-none"
                    placeholder="Ex: Adicionar um botão de login no header. Não altere a arquitetura."
                  />
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Define o escopo para evitar que os agentes sugiram mudanças desnecessárias (ex: Docker para uma task de UI).</p>
              </div>

              <div className="pt-4 border-t border-white/10 space-y-2">
                <p className="text-xs text-gray-400">Groq GPT-OSS 120B / 20B · plano gratuito com limites</p>
                <p className="text-[10px] text-gray-500">Configure GROQ_API_KEY em .env.local. Modelo por agente no editor.</p>
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={simpleTask} onChange={e => setSimpleTask(e.target.checked)} disabled={globalStatus === 'fetching' || globalStatus === 'analyzing'} />
                  Tarefa simples: usar Ollama local (opcional)
                </label>
              </div>

              <div className="flex items-center justify-between mt-4">
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={useCache} 
                    onChange={e => setUseCache(e.target.checked)}
                    className="rounded border-white/10 bg-black text-blue-500 focus:ring-blue-500"
                  />
                  Usar Cache de Análise
                </label>
                <button 
                  onClick={() => setShowHistory(true)}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <History className="w-3 h-3" /> Histórico
                </button>
              </div>

              <div className="pt-4 border-t border-white/10 flex flex-col gap-2">
                <button 
                  onClick={() => setShowAgentEditor(true)}
                  className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-all"
                >
                  <Wrench className="w-3 h-3" /> Editar Agentes (Prompts)
                </button>
                <button 
                  onClick={exportAllReports}
                  disabled={globalStatus !== 'done'}
                  className="w-full bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 text-xs font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-all"
                >
                  <FileText className="w-3 h-3" /> Exportar Tudo (.txt)
                </button>
              </div>

              <div className="flex gap-2 mt-4">
                <button 
                  onClick={handleStart}
                  disabled={globalStatus === 'fetching' || globalStatus === 'analyzing'}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-900/20"
                >
                  {globalStatus === 'idle' || globalStatus === 'done' ? <Play className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />}
                  {globalStatus === 'idle' ? 'Iniciar Fluxo' : 
                   globalStatus === 'fetching' ? 'Buscando Repo...' : 
                   globalStatus === 'analyzing' ? (activeAgents.length > 0 ? `Agente: ${activeAgents[0].toUpperCase()}${activeAgents.length > 1 ? ` (+${activeAgents.length - 1})` : ''}` : 'Analisando...') : 'Reiniciar'}
                </button>
                
                {(globalStatus === 'fetching' || globalStatus === 'analyzing') && (
                  <button 
                    onClick={handleCancel}
                    className="bg-red-600 hover:bg-red-500 text-white font-medium py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-red-900/20"
                    title="Cancelar Execução"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Groq configuration monitor */}
          <div className="bg-[#111] border border-white/10 rounded-xl p-4 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Activity className="w-3 h-3 text-blue-400" /> Groq (chave configurada)
              </h3>
              <div className={`px-2 py-0.5 rounded-full text-[8px] font-bold ${groqStatus.status === 'online' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {groqStatus.status === 'online' ? 'CONFIGURADO' : 'SEM CHAVE'}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-black/30 rounded-lg p-2 border border-white/5">
                <div className="text-[8px] text-gray-500 mb-0.5 uppercase">Latência</div>
                <div className="text-sm font-mono font-bold text-blue-400">
                  {groqStatus.responseTime ? `${groqStatus.responseTime}ms` : '--'}
                </div>
              </div>
              <div className="bg-black/30 rounded-lg p-2 border border-white/5">
                <div className="text-[8px] text-gray-500 mb-0.5 uppercase">Modelos</div>
                <div className="text-sm font-mono font-bold text-green-400">
                  {availableModels.length}
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex gap-3 text-sm text-red-200 shrink-0">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
              <p>{error}</p>
            </div>
          )}
        </div>

        {/* Right Content - Topology & Reports */}
        <div className="lg:col-span-9 flex flex-col gap-6 h-full min-h-0">
          
          {/* Top Section - Network Graph Visualization */}
          <div className="w-full bg-[#111] border border-white/10 rounded-xl p-4 shadow-xl flex-1 flex flex-col min-h-[400px]">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-2 flex items-center gap-2 shrink-0">
              <Network className="w-4 h-4" /> Topologia dos Agentes
            </h2>
            <div className="relative flex-1 w-full rounded-lg bg-black/50 border border-white/5 overflow-hidden flex items-center justify-center">
              <div className="w-full h-full relative flex items-center justify-center scale-[0.8] sm:scale-95">
                {/* Core Node */}
                <motion.div 
                  className="absolute z-20 flex flex-col items-center justify-center w-16 h-16 rounded-full border-4 border-blue-500 bg-blue-900/40 shadow-[0_0_30px_rgba(59,130,246,0.3)]"
                  style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
                  animate={{ boxShadow: ['0 0 20px rgba(59,130,246,0.2)', '0 0 40px rgba(59,130,246,0.6)', '0 0 20px rgba(59,130,246,0.2)'] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  <Server className="w-5 h-5 text-blue-400 mb-0.5" />
                  <span className="text-[8px] font-bold text-blue-300">CORE</span>
                </motion.div>

                {/* Connections */}
                {/* Experts to Core (Two Columns) */}
                {expertConfigs.filter(c => c.active).map((c, i) => {
                  // Calculate positions for two columns of experts
                  const col = i % 2;
                  const row = Math.floor(i / 2);
                  const count = expertConfigs.filter(c => c.active).length;
                  const rows = Math.ceil(count / 2);
                  
                  const x = col === 0 ? -260 : -130;
                  const spacingY = 100;
                  const startY = -((rows - 1) * spacingY) / 2;
                  const y = startY + row * spacingY;
                  
                  return (
                    <React.Fragment key={c.id}>
                      {renderConnection(x, y, 0, 0, activeAgents.includes(c.type) || activeAgents.includes('techLead'))}
                      {renderAgentNode(c.type, c.label, x, y, getIcon(c.iconName))}
                    </React.Fragment>
                  );
                })}
                
                {/* Core to Execution Pipeline */}
                {renderConnection(0, 0, 110, 0, activeAgents.includes('techLead') || activeAgents.includes('seniorDev'))}
                {renderConnection(110, 0, 220, 0, activeAgents.includes('seniorDev') || activeAgents.includes('reviewer'))}
                {renderConnection(220, 0, 330, 0, activeAgents.includes('reviewer'))}

                {/* Execution Nodes */}
                {renderAgentNode('techLead', techLeadConfig.label, 110, 0, getIcon(techLeadConfig.iconName))}
                {renderAgentNode('seniorDev', seniorDevConfig.label, 220, 0, getIcon(seniorDevConfig.iconName))}
                {renderAgentNode('reviewer', reviewerConfig.label, 330, 0, getIcon(reviewerConfig.iconName))}
                
                {/* Debugger Node (Floating) */}
                {renderAgentNode('debugger', debuggerConfig.label, 110, 120, getIcon(debuggerConfig.iconName))}
                {renderConnection(110, 120, 0, 0, activeAgents.includes('debugger'))}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400 justify-center shrink-0">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-700"></span> Aguardando</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500"></span> Processando</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Concluído</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"></span> Erro</span>
            </div>
          </div>
        </div>
      </main>

      {/* Agent Report Modal */}
      {selectedAgentReport && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setSelectedAgentReport(null)}>
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#111] border border-white/10 rounded-xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-black/20">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2 uppercase tracking-wider">
                {selectedAgentReport === 'arch' && <Network className="w-5 h-5 text-blue-400" />}
                {selectedAgentReport === 'dev' && <Code2 className="w-5 h-5 text-blue-400" />}
                {selectedAgentReport === 'sec' && <ShieldAlert className="w-5 h-5 text-blue-400" />}
                {selectedAgentReport === 'perf' && <Zap className="w-5 h-5 text-blue-400" />}
                {selectedAgentReport === 'qa' && <TestTube className="w-5 h-5 text-blue-400" />}
                {selectedAgentReport === 'devops' && <Terminal className="w-5 h-5 text-blue-400" />}
                {selectedAgentReport === 'techLead' && <UserCheck className="w-5 h-5 text-green-400" />}
                {selectedAgentReport === 'seniorDev' && <Wrench className="w-5 h-5 text-green-400" />}
                {selectedAgentReport === 'reviewer' && <Eye className="w-5 h-5 text-green-400" />}
                {selectedAgentReport === 'debugger' && <Bug className="w-5 h-5 text-red-400" />}
                Relatório do Agente: {selectedAgentReport}
              </h3>
              <button onClick={() => setSelectedAgentReport(null)} className="text-gray-400 hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors">
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-6 px-6 pt-4 border-b border-gray-800 bg-gray-900/30">
              <button 
                className={`pb-3 text-sm font-medium transition-colors relative ${activeModalTab === 'report' ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
                onClick={() => setActiveModalTab('report')}
              >
                Relatório do Agente
                {activeModalTab === 'report' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
              </button>
              <button 
                className={`pb-3 text-sm font-medium transition-colors relative ${activeModalTab === 'context' ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
                onClick={() => setActiveModalTab('context')}
              >
                Contexto & Arquivos
                {activeModalTab === 'context' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
              </button>
              {selectedAgentReport && ['seniorDev', 'reviewer'].includes(selectedAgentReport) && (
                <button 
                  className={`pb-3 text-sm font-medium transition-colors relative ${activeModalTab === 'code' ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
                  onClick={() => setActiveModalTab('code')}
                >
                  Código Gerado
                  {activeModalTab === 'code' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
                </button>
              )}
            </div>

            <div className="p-6 overflow-y-auto flex-1 bg-[#0a0a0a]">
              {activeModalTab === 'report' && (
                <>
                  {agents[selectedAgentReport].status === 'idle' && (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
                      <Network className="w-12 h-12 opacity-20" />
                      <p>Este agente ainda não iniciou o processamento.</p>
                    </div>
                  )}

                  {(agents[selectedAgentReport].status === 'running' || agents[selectedAgentReport].status === 'done') && (
                    <div className="prose prose-invert prose-blue max-w-none">
                      {agents[selectedAgentReport].status === 'running' && agents[selectedAgentReport].statusMessage && (
                        <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-300 text-xs font-mono animate-pulse">
                          {agents[selectedAgentReport].statusMessage}
                        </div>
                      )}
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {agents[selectedAgentReport].report || '*O agente está pensando...*'}
                      </ReactMarkdown>
                    </div>
                  )}

                  {agents[selectedAgentReport].status === 'error' && (
                    <div className="text-red-400">
                      {agents[selectedAgentReport].report}
                    </div>
                  )}
                </>
              )}
              
              {activeModalTab === 'context' && (
                <div className="space-y-6">
                  {/* Context Info */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-blue-400" /> 
                      Memória Alocada para este Agente
                    </h4>
                    <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 text-sm text-gray-400 leading-relaxed">
                      {selectedAgentReport === 'seniorDev' && "Este agente recebeu o Plano de Ação do Tech Lead + os primeiros 15.000 caracteres do código fonte para realizar as modificações com precisão."}
                      {selectedAgentReport === 'reviewer' && "Este agente recebeu o Plano Original, o Código Modificado pelo Dev e os primeiros 10.000 caracteres do código original para realizar a auditoria de segurança e qualidade."}
                      {selectedAgentReport === 'techLead' && "Este agente não lê o código diretamente. Ele recebeu exclusivamente os relatórios dos 6 especialistas para compilar o Plano de Ação."}
                      {selectedAgentReport === 'planner' && "Este agente recebeu a lista completa de arquivos do repositório para identificar os pontos de alteração e solicitar a leitura dinâmica de conteúdos extras."}
                      {['arch', 'dev', 'sec', 'perf', 'qa', 'devops'].includes(selectedAgentReport) && "Este especialista recebeu acesso completo a todos os arquivos listados abaixo para realizar sua análise específica."}
                    </div>
                  </div>

                  {/* Files List */}
                  {['arch', 'dev', 'sec', 'perf', 'qa', 'devops', 'seniorDev', 'reviewer', 'planner'].includes(selectedAgentReport) && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-400" /> 
                        Arquivos no Contexto ({analyzedFiles.length})
                      </h4>
                      <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
                        {analyzedFiles.length > 0 ? (
                          <ul className="divide-y divide-gray-800 max-h-64 overflow-y-auto custom-scrollbar">
                            {analyzedFiles.map((f, i) => (
                              <li key={i} className="px-4 py-2.5 flex justify-between items-center hover:bg-gray-800/50 transition-colors">
                                <span className="text-xs text-gray-300 font-mono truncate mr-4">{f.path}</span>
                                <span className="text-[10px] text-gray-400 bg-gray-800/80 px-2 py-1 rounded-md shrink-0 border border-gray-700">
                                  {(f.size / 1024).toFixed(1)} KB
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="p-6 text-sm text-gray-500 text-center flex flex-col items-center gap-2">
                            <FileText className="w-8 h-8 opacity-20" />
                            Nenhum arquivo carregado na memória ainda.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeModalTab === 'code' && (
                <div className="space-y-6">
                  <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                    <Code className="w-4 h-4 text-blue-400" /> 
                    Arquivos Prontos para Copiar
                  </h4>
                  {(() => {
                    const blocks = extractCodeBlocks(agents[selectedAgentReport].report);
                    if (blocks.length === 0) {
                      return (
                        <div className="p-6 text-sm text-gray-500 text-center flex flex-col items-center gap-2 bg-gray-900/50 border border-gray-800 rounded-lg">
                          <Code2 className="w-8 h-8 opacity-20" />
                          Nenhum bloco de código foi gerado por este agente ainda.
                        </div>
                      );
                    }
                    return blocks.map((block, idx) => (
                      <div key={idx} className="bg-gray-900/80 border border-gray-700 rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2 bg-gray-800/80 border-b border-gray-700">
                          <span className="text-xs text-gray-400 font-mono uppercase">{block.language}</span>
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(block.code);
                              setCopiedIndex(idx);
                              setTimeout(() => setCopiedIndex(null), 2000);
                            }}
                            className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded"
                          >
                            {copiedIndex === idx ? <CheckCircle className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                            {copiedIndex === idx ? 'Copiado!' : 'Copiar Código'}
                          </button>
                        </div>
                        <pre className="p-4 text-sm text-gray-300 font-mono overflow-x-auto custom-scrollbar">
                          <code>{block.code}</code>
                        </pre>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* History Modal */}
      {showHistory && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#111] border border-white/10 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <History className="w-5 h-5" /> Histórico de Análises
              </h3>
              <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-3">
              {history.length === 0 ? (
                <p className="text-gray-500 text-center py-8">Nenhum histórico encontrado.</p>
              ) : (
                history.map(entry => (
                  <div key={entry.id} className="bg-black/50 border border-white/5 rounded-lg p-4 flex items-center justify-between hover:border-blue-500/30 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-blue-400 truncate max-w-[300px]">{entry.repoUrl}</p>
                      <p className="text-xs text-gray-500 mt-1">{entry.date}</p>
                    </div>
                    <button 
                      onClick={() => loadHistoryEntry(entry)}
                      className="px-3 py-1.5 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded text-xs font-medium transition-colors"
                    >
                      Carregar
                    </button>
                  </div>
                ))
              )}
            </div>
            {history.length > 0 && (
              <div className="p-4 border-t border-white/10 flex justify-end">
                <button 
                  onClick={clearHistory}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Limpar Histórico
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Agent Editor Modal */}
      {showAgentEditor && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#111] border border-white/10 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Wrench className="w-5 h-5" /> Editor de Agentes e Prompts
                </h3>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => {
                      if (confirm('Deseja resetar todos os agentes para as configurações padrão (Groq GPT-OSS 120B)?')) {
                        setExpertConfigs(defaultExpertConfigs);
                        setTechLeadConfig({ id: 'techLead', type: 'techLead', label: 'TECH LEAD', iconName: 'UserCheck', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Tech Lead experiente. Sua função é validar recomendações técnicas e criar um plano de ação HOLÍSTICO e INTEGRADO. Não aceite soluções isoladas; garanta que o plano cubra TODOS os arquivos afetados. Priorize a modificação de arquivos existentes para manter a coesão do sistema antes de sugerir a criação de novos arquivos.' });
                        setSeniorDevConfig({ id: 'seniorDev', type: 'seniorDev', label: 'SENIOR DEV', iconName: 'Wrench', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Desenvolvedor Sênior de elite. Você não trabalha sozinho; você segue o plano do Tech Lead mas tem visão crítica. Dê preferência absoluta a modificar arquivos existentes para manter a coesão do projeto. Evite criar novos arquivos se a funcionalidade puder ser integrada em um local existente. Escreva código que se integre perfeitamente ao projeto, respeitando padrões e arquitetura.' });
                        setReviewerConfig({ id: 'reviewer', type: 'reviewer', label: 'REVIEWER', iconName: 'Eye', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Revisor de Código implacável. Você não deixa passar nenhum erro, vulnerabilidade ou código mal escrito.' });
                        setDebuggerConfig({ id: 'debugger', type: 'debugger', label: 'DEBUGGER', iconName: 'Bug', active: true, model: GROQ_MODEL, systemPrompt: 'Você é um Especialista em Debugging e SRE. Sua função é analisar erros do Groq ou do sistema. Para limites de uso, respeite a espera e reduza o contexto. Nunca recomende modelos pagos ou migração automática para Ollama.' });
                      }
                    }}
                    className="text-[10px] text-red-400 hover:text-red-300 font-bold border border-red-900/30 px-2 py-1 rounded"
                  >
                    Resetar para Padrão
                  </button>
                  <button onClick={() => setShowAgentEditor(false)} className="text-gray-400 hover:text-white">✕</button>
                </div>
              </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-8 custom-scrollbar">
              
              {/* Core Agents */}
              <div>
                <h4 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-4">Agentes do Core (Pipeline Principal)</h4>
                <div className="grid grid-cols-1 gap-4">
                  {[techLeadConfig, seniorDevConfig, reviewerConfig].map((config, idx) => (
                    <div key={config.id} className="bg-black/40 border border-white/5 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {getIcon(config.iconName)}
                          <span className="text-sm font-bold text-white">{config.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-500 uppercase font-bold">Modelo:</span>
                          <select
                            value={config.model}
                            onChange={e => {
                              const val = e.target.value;
                              if (config.id === 'techLead') setTechLeadConfig(prev => ({ ...prev, model: val }));
                              if (config.id === 'seniorDev') setSeniorDevConfig(prev => ({ ...prev, model: val }));
                              if (config.id === 'reviewer') setReviewerConfig(prev => ({ ...prev, model: val }));
                              if (config.id === 'debugger') setDebuggerConfig(prev => ({ ...prev, model: val }));
                            }}
                            className="bg-black border border-white/10 rounded px-2 py-0.5 text-[10px] text-blue-400 font-mono focus:outline-none focus:border-blue-500 w-32"
                          >
                              {GROQ_MODELS.map(model => <option key={model} value={model}>{model}</option>)}
                          </select>
                        </div>
                      </div>
                      <textarea 
                        value={config.systemPrompt}
                        onChange={e => {
                          const val = e.target.value;
                          if (config.id === 'techLead') setTechLeadConfig(prev => ({ ...prev, systemPrompt: val }));
                          if (config.id === 'seniorDev') setSeniorDevConfig(prev => ({ ...prev, systemPrompt: val }));
                          if (config.id === 'reviewer') setReviewerConfig(prev => ({ ...prev, systemPrompt: val }));
                          if (config.id === 'debugger') setDebuggerConfig(prev => ({ ...prev, systemPrompt: val }));
                        }}
                        className="w-full bg-black border border-white/10 rounded-lg p-3 text-xs font-mono focus:border-blue-500 focus:outline-none min-h-[100px]"
                      />
                    </div>
                  ))}
                  
                  {/* Debugger Config separately if not in the map above */}
                  <div key={debuggerConfig.id} className="bg-black/40 border border-white/5 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {getIcon(debuggerConfig.iconName)}
                          <span className="text-sm font-bold text-white">{debuggerConfig.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-500 uppercase font-bold">Modelo:</span>
                          <select
                            value={debuggerConfig.model}
                            onChange={e => setDebuggerConfig(prev => ({ ...prev, model: e.target.value }))}
                            className="bg-black border border-white/10 rounded px-2 py-0.5 text-[10px] text-blue-400 font-mono focus:outline-none focus:border-blue-500 w-32"
                          >
                              {GROQ_MODELS.map(model => <option key={model} value={model}>{model}</option>)}
                          </select>
                        </div>
                      </div>
                      <textarea 
                        value={debuggerConfig.systemPrompt}
                        onChange={e => setDebuggerConfig(prev => ({ ...prev, systemPrompt: e.target.value }))}
                        className="w-full bg-black border border-white/10 rounded-lg p-3 text-xs font-mono focus:border-blue-500 focus:outline-none min-h-[100px]"
                      />
                  </div>
                </div>
              </div>

              {/* Expert Agents */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xs font-bold text-blue-400 uppercase tracking-widest">Agentes Especialistas (Análise Inicial)</h4>
                  <button 
                    onClick={() => {
                      const newId = `custom_${Date.now()}`;
                      setExpertConfigs(prev => [...prev, {
                        id: newId,
                        type: newId,
                        label: 'NOVO AGENTE',
                        iconName: 'Code2',
                        active: true,
                        model: GROQ_MODEL,
                        systemPrompt: 'Você é um especialista em...'
                      }]);
                    }}
                    className="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded font-bold"
                  >
                    + Adicionar Agente
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  {expertConfigs.map((config, idx) => (
                    <div key={config.id} className="bg-black/40 border border-white/5 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <input 
                            type="checkbox" 
                            checked={config.active}
                            onChange={e => {
                              const updated = [...expertConfigs];
                              updated[idx].active = e.target.checked;
                              setExpertConfigs(updated);
                            }}
                            className="rounded border-white/10 bg-black text-blue-500"
                          />
                          <input 
                            type="text" 
                            value={config.label}
                            onChange={e => {
                              const updated = [...expertConfigs];
                              updated[idx].label = e.target.value.toUpperCase();
                              setExpertConfigs(updated);
                            }}
                            className="bg-transparent border-b border-white/10 text-sm font-bold text-white focus:outline-none focus:border-blue-500 px-1"
                          />
                          <div className="flex items-center gap-2 ml-4">
                            <span className="text-[10px] text-gray-500 uppercase font-bold">Modelo:</span>
                            <select
                              value={config.model}
                              onChange={e => {
                                const updated = [...expertConfigs];
                                updated[idx].model = e.target.value;
                                setExpertConfigs(updated);
                              }}
                              className="bg-black border border-white/10 rounded px-2 py-0.5 text-[10px] text-blue-400 font-mono focus:outline-none focus:border-blue-500 w-32"
                            >
                              {GROQ_MODELS.map(model => <option key={model} value={model}>{model}</option>)}
                            </select>
                          </div>
                        </div>
                        <button 
                          onClick={() => {
                            setExpertConfigs(prev => prev.filter(c => c.id !== config.id));
                          }}
                          className="text-red-500 hover:text-red-400 p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <textarea 
                        value={config.systemPrompt}
                        onChange={e => {
                          const updated = [...expertConfigs];
                          updated[idx].systemPrompt = e.target.value;
                          setExpertConfigs(updated);
                        }}
                        className="w-full bg-black border border-white/10 rounded-lg p-3 text-xs font-mono focus:border-blue-500 focus:outline-none min-h-[80px]"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 flex justify-center">
                <button 
                  onClick={() => {
                    localStorage.removeItem('agent_configs_experts');
                    localStorage.removeItem('agent_config_techlead');
                    localStorage.removeItem('agent_config_seniordev');
                    localStorage.removeItem('agent_config_reviewer');
                    window.location.reload();
                  }}
                  className="text-[10px] text-gray-500 hover:text-red-400 underline"
                >
                  Resetar todos os agentes para o padrão de fábrica
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

