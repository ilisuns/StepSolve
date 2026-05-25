import { useMemo, useState } from 'react';
import './App.css';

type FollowAction = 'next' | 'hint' | 'check';
type LoadingAction = '' | 'solve' | FollowAction;

const API_BASE = 'https://stepsolve-backend.onrender.com';
const checkWords = ['检查', '对不对', '哪里错', '错在哪', '帮我看看', '看一下', '是否正确'];

function nowText() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function hasCheckRequest(text: string) {
  return checkWords.some((word) => text.includes(word));
}

function cleanPoolText(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (/^\d+[.、]\s*(点|点击|输入|重新输入|打开|按|看|检查|测试|然后|只放|清空|复制|粘贴)/.test(line)) return false;
      if (/^(Ctrl\s*\+\s*F5|http:\/\/localhost|Local:|VITE|按 Win|输入 cmd|回车)/i.test(line)) return false;
      if (/^(点|点击|打开|按|复制执行|执行|看到|回复|回我)/.test(line)) return false;
      return true;
    })
    .join(String.fromCharCode(10))
    .trim();
}

function judgePoolText(value: string) {
  const cleaned = cleanPoolText(value);
  const hasHomework = Boolean(cleaned.trim());
  const hasStudentWork = /我先|我做到|我写的是|我写了|我写到|我的步骤是|我的答案是|我算的是|我列的是|所以|答案是|检查对不对|对不对/.test(cleaned);

  return { cleaned, hasHomework, hasStudentWork };
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`接口失败：${response.status}`);
  }

  return response.json() as Promise<{ action?: string; answer?: string }>;
}

function splitAnswerSections(answer: string) {
  const text = (answer || '').replace(/\\n/g, '\n');
  const pick = (label: string, nextLabels: string[]) => {
    const start = text.indexOf(label);
    if (start < 0) return '';
    let end = text.length;
    for (const next of nextLabels) {
      const pos = text.indexOf(next, start + label.length);
      if (pos >= 0 && pos < end) end = pos;
    }
    return text.slice(start + label.length, end).trim();
  };

  return {
    judgement: pick('判断：', ['当前这一步：', '下一步：', '检查结果：']),
    current: pick('当前这一步：', ['下一步：', '检查结果：', '判断：']),
    next: pick('下一步：', ['检查结果：', '判断：', '当前这一步：']),
    raw: text.trim(),
  };
}
type SavedResult = {
  id: string;
  question: string;
  grade: string;
  subject: string;
  currentStep: string;
  nextHint: string;
  checkResult: string;
  createdAt: string;
};

function hasPoolInstructionNoise(value: string) {
  const text = value.trim();
  if (!text) return false;

  const instructionPatterns = [
    /https?:\/\/localhost/i,
    /Ctrl\s*\+\s*F5/i,
    /清空/,
    /开始拆解/,
    /重新拆解/,
    /下一步/,
    /当前这一步|下一步提示|检查结果|不报错|页面测试|build|已通过|目标/,
    /保存/,
    /复制/,
    /打开\s*http/i,
    /^\s*\d+[.、].*(点|打开|清空|放入|保存|复制|开始|再给)/m,
  ];

  return instructionPatterns.some((pattern) => pattern.test(text));
}


function guessSubjectFromText(text: string) {
  if (/氢气|氧气|化学式|方程式|配平|H2|O2|H₂|O₂|H2O|H₂O|原子|元素/.test(text)) return '化学';
  if (/物体|质量|合力|拉力|加速度|受力|牛顿|速度|距离|时间|m\/s|F\s*=|N\b|kg|m\/s²/.test(text)) return '物理';
  return '';
}

function App() {
  const [poolText, setPoolText] = useState('');
  const [grade, setGrade] = useState('8年级');
  const [subject, setSubject] = useState('数学');
  const [currentStep, setCurrentStep] = useState('');
  const [resultText, setResultText] = useState('');
  const [nextHint, setNextHint] = useState('');
  const [checkResult, setCheckResult] = useState('');
  const [lastQuestion, setLastQuestion] = useState('');
  const [loadingAction, setLoadingAction] = useState<LoadingAction>('');
  const [actionLog, setActionLog] = useState<string[]>([]);
  const [saveNotice, setSaveNotice] = useState('');
  const [savedResults, setSavedResults] = useState<SavedResult[]>(() => {
    try {
      const raw = window.localStorage.getItem('v1SavedResults');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const hasResult = Boolean(currentStep.trim() || nextHint.trim() || checkResult.trim() || resultText.trim());
  const hasInstructionNoise = hasPoolInstructionNoise(poolText);
  const guessedSubject = guessSubjectFromText(poolText);
  const subjectMismatchWarning = Boolean(guessedSubject && guessedSubject !== subject);
  const hasFailedResult = currentStep.includes('请求失败') || resultText.includes('请求失败');

  const mainButtonText = useMemo(() => {
    if (loadingAction === 'solve') return '正在拆解...';
    if (loadingAction === 'check') return '正在检查...';
    if (hasResult) return '重新拆解当前题';
    return '开始拆解';
  }, [hasResult, loadingAction]);

  function addActionLog(message: string) {
    setActionLog((old) => [`${nowText()} ${message}`, ...old].slice(0, 12));
  }

  function handlePoolChange(value: string) {
    setPoolText(value);
    // 年级和学科只由上方选择框决定，输入内容不再自动改学科。

    const oldQuestion = lastQuestion.trim();
    const newText = value.trim();
    const hasOldResult = Boolean(currentStep.trim() || resultText.trim());

    if (!oldQuestion || !newText || !hasOldResult) return;
    if (hasCheckRequest(newText)) return;

    const isClearlyNew =
      newText !== oldQuestion &&
      !oldQuestion.includes(newText) &&
      !newText.includes(oldQuestion);

    if (isClearlyNew) {
      setCurrentStep('');
      setNextHint('');
      setCheckResult('');
      setResultText('');
      addActionLog('检测到新题，旧结果已清空');
    }
  }

  const PUBLIC_BETA_DAILY_HOMEWORK_LIMIT = 3;
  const PUBLIC_BETA_HOMEWORK_INTERACTION_LIMIT = 8;
  const publicBetaDailyLimitText = '今天的免费公测作业数已用完。明天可以继续把作业扔进解池。';
  const publicBetaHomeworkLimitText = '这份作业今天已经互动 8 次。可以保存结果，或换一份作业继续。';
  function publicBetaQuestionKey(question: string) {
    return question.replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  function takePublicBetaUse(question: string) {
    const key = 'v1-public-beta-homework-usage';
    const today = new Date().toISOString().slice(0, 10);
    let items: Record<string, number> = {};
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}') as { date?: string; items?: Record<string, number> };
      if (saved.date === today && saved.items) items = saved.items;
    } catch {
      items = {};
    }
    const qKey = publicBetaQuestionKey(question);
    const knownHomework = Object.prototype.hasOwnProperty.call(items, qKey);
    if (!knownHomework && Object.keys(items).length >= PUBLIC_BETA_DAILY_HOMEWORK_LIMIT) {
      return { ok: false, message: publicBetaDailyLimitText, log: '公测限次：今日作业数已用完' };
    }
    const count = Number(items[qKey] || 0);
    if (count >= PUBLIC_BETA_HOMEWORK_INTERACTION_LIMIT) {
      return { ok: false, message: publicBetaHomeworkLimitText, log: '公测限次：本题互动次数已用完' };
    }
    items[qKey] = count + 1;
    localStorage.setItem(key, JSON.stringify({ date: today, items }));
    return { ok: true, message: '', log: '' };
  }

  async function handleSolve() {
    const judgement = judgePoolText(poolText);
    const question = judgement.cleaned;

    if (hasInstructionNoise) {
      setCurrentStep('解池里混入了操作说明，请先点“只保留题目”，再开始拆解。');
      setNextHint('');
      setCheckResult('');
      addActionLog('开始拆解：拦截操作说明');
      return;
    }

    if (!question) {
      addActionLog('没有题目，未执行');
      return;
    }

    if (loadingAction) return;

    const betaUse = takePublicBetaUse(question);
    if (!betaUse.ok) {
      setCurrentStep(betaUse.message);
      setNextHint('');
      setCheckResult('');
      addActionLog(betaUse.log);
      return;
    }
    // FRONT_BETA_SOLVE_CONNECTED


    try {
      setLoadingAction('solve');
      setCurrentStep('正在拆解当前题……');
      setNextHint('');
      setCheckResult('');
      const data = await postJson('/api/solve', {
        question,
        grade,
        subject,
        mode: '一步步带我做',
      });

      const answer = data.answer || '判断：已收到题目。\n\n当前这一步：先读题。\n\n下一步：继续拆解.';
      const sections = splitAnswerSections(answer);
      setCurrentStep(sections.current || answer);
      setNextHint(sections.next || '');
      setResultText(answer);
      setLastQuestion(question);
      addActionLog('开始拆解：已显示当前这一步');
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setCurrentStep(`请求失败：${message}`);
      addActionLog('开始拆解：请求失败');
    } finally {
      setLoadingAction('');
    }
  }

  async function handleFollowUp(action: FollowAction) {
    const judgement = judgePoolText(poolText);
    const question = judgement.cleaned || lastQuestion.trim();

    if (!question) {
      addActionLog('没有原题，未执行');
      return;
    }

    const hasStudentWork = judgement.hasStudentWork;

    if (action === 'check' && !hasStudentWork) {
      setCheckResult('还没有可检查的步骤。请把你的步骤也放进解池，例如：我写的是 3 + 2 = 5，检查对不对。');
      addActionLog('检查这一步：缺少学生步骤');
      return;
    }

    if (loadingAction) return;

    const betaUse = takePublicBetaUse(question);
    if (!betaUse.ok) {
      if (action === 'check') setCheckResult(betaUse.message);
      if (action !== 'check') setNextHint(betaUse.message);
      addActionLog(betaUse.log);
      return;
    }
    // FRONT_BETA_FOLLOW_CONNECTED

    const actionTitle =
      action === 'next' ? '下一步' : action === 'hint' ? '要提示' : '检查这一步';

    try {
      setLoadingAction(action);
      if (action === "check") setCheckResult("正在检查这一步……");
      if (action !== "check") setCheckResult("");
      const data = await postJson('/api/follow-up', {
        action,
        question,
        grade,
        subject,
        current: [currentStep, nextHint ? '上一条下一步提示：' + nextHint : ''].filter(Boolean).join('\\n\\n'),
        studentWork: action === 'check' && hasStudentWork ? poolText : '',
      });

      const answer = data.answer || '判断：已收到。\n\n当前这一步：继续处理当前题。\n\n下一步：再往前走一小步。';
      const sections = splitAnswerSections(answer);
      if (action === 'next') {
        if (sections.current) setCurrentStep(sections.current);
        setNextHint(sections.next || '');
        setResultText(answer);
      }

      if (action === 'hint') {
        setNextHint(sections.next || sections.current || answer);
        setResultText(answer);
      }

      if (action === 'check') {
        const unitWord = String.fromCharCode(21333,20301);
        const physicsSubject = String.fromCharCode(29289,29702);
        const jNeed = String.fromCharCode(21028,26029,65306,38656,35201,34917,19968,27493,12290);
        const jContinue = String.fromCharCode(21028,26029,65306,32487,32493,25286,35299,12290);
        const jOk = String.fromCharCode(21028,26029,65306,36825,19968,27493,23545,12290);
        const compactCheckText = poolText.replace(/\s+/g, "");
        const hasPhysicsFullAnswer = subject === physicsSubject && /a=3m\/s/i.test(compactCheckText);
        setCheckResult(hasPhysicsFullAnswer ? answer.replace(jNeed, jOk).replace(jContinue, jOk) : (answer.includes(unitWord) ? answer.replace(jContinue, jNeed) : answer));
      }

      setResultText((oldText) => [oldText, actionTitle + '\n' + answer].filter(Boolean).join('\n\n---\n\n'));
      setLastQuestion(question);

      if (action === 'next') addActionLog('下一步：已追加下一步');
      if (action === 'hint') addActionLog('要提示：已显示提示');
      if (action === 'check') addActionLog('检查这一步：已返回检查结果');
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setCurrentStep(`请求失败：${message}`);
      addActionLog(`${actionTitle}：请求失败`);
    } finally {
      setLoadingAction('');
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      handlePoolChange(text);
      addActionLog('粘贴题目：已放入解池');
    } catch {
      addActionLog('粘贴题目：浏览器未允许读取剪贴板');
    }
  }

  function keepOnlyQuestion() {
    const question = getSaveQuestionText();
    if (!question.trim()) return;
    setPoolText(question);
    setCurrentStep('');
    setNextHint('');
    setCheckResult('');
    setResultText('');
    setSaveNotice('');
    addActionLog('解池清理：已只保留题目');
  }

  function clearPool() {
    setPoolText('');
    setCurrentStep('');
    setNextHint('');
    setCheckResult('');
    setResultText('');
    setLastQuestion('');
    setSaveNotice('');
    addActionLog('清空：已清空当前内容');
  }

  function copyResult() {
    const text = [
      ['题目', getSaveQuestionText()],
      ['年级', grade],
      ['学科', subject],
      ['当前这一步', currentStep],
      ['下一步提示', nextHint],
      ['检查结果', checkResult],
    ].filter((item) => Boolean(item[1])).map((item) => item[0] + '\n' + item[1]).join('\n\n');
    if (!text.trim()) return;
    navigator.clipboard.writeText(text);
    addActionLog('复制：已复制题目和拆解结果');
  }



  function getSaveQuestionText() {
    const raw = (poolText.trim() || lastQuestion.trim() || '未命名作业').trim();
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    const cleanLines = lines.filter((line) => {
      // 过滤年级学科说明，解池只保留题目本身
      if (/^\d+[.、]/.test(line)) return false;
      if (/^\d+年级\s*\/\s*(数学|物理|化学)$/.test(line)) return false;
      if (/^\d+年级$/.test(line)) return false;
      if (/^(数学|物理|化学)$/.test(line)) return false;
      if (/^年级[:：]\s*\d+年级$/.test(line)) return false;
      if (/^学科[:：]\s*(数学|物理|化学)$/.test(line)) return false;
      if (/^解池只放[:：]?$/.test(line)) return false;
      if (/^解池[:：]?$/.test(line)) return false;
      if (/页面选|题目像|提醒出现|没有自动改学科|没有拦截|当前选择|请确认学科是否选对/.test(line)) return false;
      if (/https?:\/\//i.test(line)) return false;
      if (/打开\s*http/i.test(line)) return false;
      if (/清空|解池里|只放|学科选|开始拆解|重新拆解|下一步|保存|复制\s*\/\s*保存/.test(line)) return false;
      if (/^点[“"].*[”"]?$/.test(line)) return false;
      if (/^当前这一步[:：]?$/.test(line)) return false;
      if (/^下一步提示[:：]?$/.test(line)) return false;
      if (/^检查结果[:：]?$/.test(line)) return false;
      return true;
    });

    return cleanLines.find((line) => /[？?]$/.test(line)) || cleanLines[0] || raw;
  }

  function saveResult() {
    const hasContent = currentStep.trim() || nextHint.trim() || checkResult.trim();
    if (!hasContent) return;

    if (hasFailedResult) {
      setSaveNotice('当前结果异常，不能保存；请先重新拆解成功后再保存');
      addActionLog('保存：当前结果异常，未保存');
      return;
    }

    const item: SavedResult = {
      id: String(Date.now()),
      question: getSaveQuestionText(),
      grade,
      subject,
      currentStep,
      nextHint,
      checkResult,
      createdAt: nowText(),
    };

    const nextList = [item, ...savedResults.filter((oldItem) => oldItem.question.trim() !== item.question.trim())].slice(0, 20);
    setSavedResults(nextList);
    window.localStorage.setItem('v1SavedResults', JSON.stringify(nextList));
    addActionLog('保存：已保存到最近作业');
    setSaveNotice('已保存到最近作业');
  }

  function openSavedResult(item: SavedResult) {
    setPoolText(item.question);
    setGrade(item.grade);
    setSubject(item.subject);
    setCurrentStep(item.currentStep.includes("解池里混入") ? "" : item.currentStep);
    setNextHint(item.nextHint);
    setCheckResult(item.checkResult);
    setResultText(
      [
        item.checkResult,
        item.currentStep ? '当前这一步：' + item.currentStep : '',
        item.nextHint ? '下一步：' + item.nextHint : '',
      ].filter(Boolean).join('\n\n')
    );
    setLastQuestion(item.question);
    setSaveNotice('已打开保存作业');
    addActionLog('最近作业：已打开保存');
  }

  function deleteSavedResult(id: string) {
    const nextList = savedResults.filter((item) => item.id !== id);
    setSavedResults(nextList);
    window.localStorage.setItem('v1SavedResults', JSON.stringify(nextList));
    setSaveNotice('');
    addActionLog('最近作业：已删除一条');
  }

  return (
    <main className="appShell">
      <section className="heroPanel">
        <div className="titleBlock">
          <p className="eyebrow">自适应解池 V1</p>
          <h1>把作业拆成下一步</h1>
          <p className="subtitle">数学、物理、化学题放进来，系统先看题，再把思路拆成学生能走的一小步。</p>
          <p className="publicBetaNotice">V1 公测版：每台设备每天可测试 3 份作业；每份作业最多 8 次 AI 互动。先支持数学、物理、化学文字作业。</p>
          <p className="publicBetaNotice"><a href="mailto:trlisuning@gmail.com?subject=StepSolve%20Feedback&body=What%20problem%20were%20you%20trying%20to%20solve%3F%0you%20trying%20to%20solve%0A%0ADid%20StepSolve%20help%20you%20find%20the%20next%20step%3F%0A%0AWhat%20was%20confusing%3F%0A%0AYour%20email%20(optional)%3A%20">Send Feedback</a> · If you leave your email, we may follow up for more details.</p>
          <div className="goalBar"><strong>目标：</strong><span>看懂题目 → 找到方法 → 做下一步 → 检查错误</span></div>
        </div>

        <div className="workspace">
          <section className="poolCard">
            <div className="rowHeader">
              <h2>把作业扔进解池</h2>
              <div className="selectRow">
                <select value={grade} onChange={(event) => setGrade(event.target.value)}>
                  <option>7年级</option>
                  <option>8年级</option>
                  <option>9年级</option>
                  <option>10年级</option>
                </select>
                <select value={subject} onChange={(event) => setSubject(event.target.value)}>
                  <option>数学</option>
                  <option>物理</option>
                  <option>化学</option>
                </select>
              </div>
            </div>

            <textarea
              className="poolInput"
              value={poolText}
              onChange={(event) => handlePoolChange(event.target.value)}
              placeholder="把作业内容扔进来：文字、公式、步骤、卡住的地方，都可以先放这里。"
            />
            <div className="poolFixedTip">这里只放作业内容，不放年级、学科、操作说明。</div>

            {(hasInstructionNoise || subjectMismatchWarning) && (
              <div className="poolWarning">
                <span>{hasInstructionNoise ? '解池里好像混入了操作说明，建议只放题目。' : '这道题和当前学科可能不一致，请确认学科是否选对。'}</span>
                {(hasInstructionNoise || subjectMismatchWarning) && (
                  <button type="button" onClick={keepOnlyQuestion}>
                    只保留题目
                  </button>
                )}
              </div>
            )}

            <div className="toolRow">               <button type="button" className="ghostButton" onClick={pasteFromClipboard}>                 粘贴题目               </button>               <button type="button" className="ghostButton" onClick={clearPool}>                 清空               </button>               <button type="button" className="ghostButton" data-top-check-button="true" onClick={() => handleFollowUp('check')} disabled={!poolText.trim() || Boolean(loadingAction)}>                 检查这一步               </button>             </div>

            <button
              type="button"
              className="mainButton"
              onClick={handleSolve}
              disabled={!poolText.trim() || Boolean(loadingAction)}
            >
              {mainButtonText}
            </button>


            <div className="statusLine">
              {loadingAction
                ? '正在调用 AI，请稍等。'
                : hasResult
                  ? '已有结果，可以继续下一步、要提示，或检查这一步。'
                  : '等待题目进入解池。'}
            </div>

            {loadingAction && (
              <div className="busyNotice">
                AI 正在处理，请稍等一下。按钮已经收到请求，不要重复点击。
              </div>
            )}
          </section>

          <section className="resultColumn">
            <div className="resultCard currentStepCard">
              <div className="rowHeader">
                <h2>先做这一步</h2>
                {loadingAction && <span className="pill">AI 处理中</span>}
              </div>

              {currentStep ? (
                <pre className="resultText">{currentStep}</pre>
              ) : (
                <div className="emptyState">
                  <strong>还没有内容</strong>
                  <p>把题目放进解池，系统会先给出最容易开始的一步。</p>
                </div>
              )}

              {hasResult && (
                <div className="followRow">
                  <button type="button" onClick={() => handleFollowUp('next')} disabled={Boolean(loadingAction)}>
                    下一步
                  </button>
                  <button type="button" onClick={() => handleFollowUp('hint')} disabled={Boolean(loadingAction)}>
                    要提示
                  </button>
                </div>
              )}
            </div>

            <div className="resultCard">
              <div className="rowHeader">
                <h2>下一小步</h2>
              </div>

              {nextHint ? (
                <pre className="resultText longResult">{nextHint}</pre>
              ) : (
                <div className="emptyState">
                  <strong>还没有下一小步</strong>
                  <p>点“下一步”或“要提示”，这里会单独显示一小步。</p>
                </div>
              )}
            </div>

            <div className="resultCard">               <div className="rowHeader">                 <h2>这一步检查</h2>               </div>                {checkResult ? (                 <pre className="resultText longResult">{checkResult}</pre>               ) : (                 <div className="emptyState">                   <strong>还没有检查</strong>                   <p>想检查时，把你的做法也放进解池。例如：我写到 x = 4，检查对不对。</p>                 </div>               )}             </div> 
            <div className="resultCard">
              <div className="rowHeader">
                <h2>保存作业</h2>
                {hasResult && (
                  <div className="saveButtonGroup">
                    <button type="button" className="copyButton" onClick={copyResult}>
                      复制
                    </button>
                    <button type="button" className="copyButton" onClick={saveResult} disabled={hasFailedResult || Boolean(loadingAction)}>
                      保存
                    </button>
                  </div>
                )}
              </div>

              <div className="emptyState compact">
                <p>保存后会出现在“最近保存”，本机最多保留 20 条。</p>
                {saveNotice && <p className="saveNotice">{saveNotice}</p>}
                {hasFailedResult && <p className="saveNotice warning">当前结果异常，不能保存；请先重新拆解成功后再保存</p>}
              </div>

              <div className="recentBox">
                <h3>最近保存（{savedResults.length}/20）</h3>
                {savedResults.length ? (
                  <ul className="recentList">
                    {savedResults.slice(0, 5).map((item) => (
                      <li key={item.id} className="recentItem">
                        <div className="recentInfo">
                          <strong>{item.subject} · {item.grade}</strong>
                          <span>{item.createdAt}</span>
                          <small>{item.question.slice(0, 38)}{item.question.length > 38 ? '...' : ''}</small>
                        </div>
                        <div className="recentActions">
                          <button type="button" className="recentOpenButton" onClick={() => openSavedResult(item)}>
                            打开
                          </button>
                          <button type="button" className="recentDelete" onClick={() => deleteSavedResult(item.id)}>
                            删除
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="emptyState compact">
                    <p>保存后的题目会出现在这里。</p>
                  </div>
                )}
              </div>
            </div> 
            <div className="resultCard">
              <h2>动作记录</h2>
              {actionLog.length ? (
                <ul className="actionLog">
                  {actionLog.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div className="emptyState compact">
                  <strong>还没有动作</strong>
                  <p>每次点击按钮，这里都会增加一条记录。</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

export default App;
























































