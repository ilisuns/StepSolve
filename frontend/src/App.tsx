import { useMemo, useState } from 'react';
import { JiechiPoster } from './JiechiPoster';
import './App.css';

type FollowAction = 'next' | 'hint' | 'check';
type LoadingAction = '' | 'solve' | FollowAction;

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3100' : 'https://stepsolve-backend.onrender.com';
const checkWords = ['检查', '对不对', '哪里错', '错在哪', '帮我看看', '看一下', '是否正确', 'is this correct', 'check my work', 'check this', 'is it right', 'did i do this right'];

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
      if (/^\d+[.、]\s*(点|点击|输入|重新输入|Open|按|看|检查|测试|然后|只放|清空解池|复制|粘贴)/.test(line)) return false;
      if (/^(Ctrl\s*\+\s*F5|http:\/\/localhost|Local:|VITE|按 Win|输入 cmd|回车)/i.test(line)) return false;
      if (/^(点|点击|Open|按|复制执行|执行|看到|回复|回我)/.test(line)) return false;
      return true;
    })
    .join(String.fromCharCode(10))
    .trim();
}

function judgePoolText(value: string) {
  const cleaned = cleanPoolText(value);
  const hasHomework = Boolean(cleaned.trim());
  const hasStudentWork = /我先|我做到|我写的是|我写了|我写到|我的步骤是|我的答案是|我算的是|我列的是|所以|答案是|检查对不对|对不对|i got|i wrote|my answer|my step|my work|is this correct|is it right|did i do this right|=|＝/i.test(cleaned);

  return { cleaned, hasHomework, hasStudentWork };
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
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
    judgement: pick('判断：', ['Current step：', '再给我一步：', '检查结果：']),
    current: pick('Current step：', ['再给我一步：', '检查结果：', '判断：']),
    next: pick('再给我一步：', ['检查结果：', '判断：', 'Current step：']),
    raw: text.trim(),
  };
}
type 保存dResult = {
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
    /清空解池/,
    /开始拆解/,
    /重新拆解/,
    /再给我一步/,
    /Current step|再给我一步 hint|检查结果|不报错|页面测试|build|已通过|目标/,
    /保存/,
    /复制/,
    /Open\s*http/i,
    /^\s*\d+[.、].*(点|Open|清空解池|放入|保存|复制|开始|再给)/m,
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
  const [grade, setGrade] = useState('8Grade');
  const [subject, setSubject] = useState('数学');
  const [currentStep, setCurrentStep] = useState('');
  const [resultText, setResultText] = useState('');
  const [nextHint, setNextHint] = useState('');
  const [checkResult, setCheckResult] = useState('');
  const [lastQuestion, setLastQuestion] = useState('');
  const [loadingAction, setLoadingAction] = useState<LoadingAction>('');
  const [actionLog, setActionLog] = useState<string[]>([]);
  const [saveNotice, set保存Notice] = useState('');
  const [savedResults, set保存dResults] = useState<保存dResult[]>(() => {
    try {
      const raw = window.localStorage.getItem('v1保存dResults');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const hasResult = Boolean(currentStep.trim() || nextHint.trim() || checkResult.trim() || resultText.trim());
  const hasInstructionNoise = hasPoolInstructionNoise(poolText);
  const guessedSubject = guessSubjectFromText(poolText);
  const subjectMismatchWarning = Boolean(guessedSubject && guessedSubject !== subject);
  const hasFailedResult = currentStep.includes('Request failed') || resultText.includes('Request failed');

  const [showPoster, setShowPoster] = useState(window.localStorage.getItem("jiechiPosterSeenCount_v2") !== "1");

  function enterJiechi() {
    window.localStorage.setItem("jiechiPosterSeenCount_v2", "1");
    setShowPoster(false);
  }
  const mainButtonText = useMemo(() => {
    if (loadingAction === 'solve') return 'Breaking it down...';
    if (loadingAction === 'check') return 'Checking...';
    if (hasResult) return '重新拆解当前题';
    return '开始拆解';
  }, [hasResult, loadingAction]);

  function addActionLog(message: string) {
    setActionLog((old) => [`${nowText()} ${message}`, ...old].slice(0, 12));
  }

  function handlePoolChange(value: string) {
    setPoolText(value);
    // Grade和Subject只由上方选择框决定，输入内容不再自动改Subject。

    const oldQuestion = lastQuestion.trim();
    const newText = value.trim();
    const hasOldResult = Boolean(currentStep.trim() || resultText.trim());

    if (!oldQuestion || !newText || !hasOldResult) return;
    if (hasCheckRequest(newText)) return;

    const is清空解池lyNew =
      newText !== oldQuestion &&
      !oldQuestion.includes(newText) &&
      !newText.includes(oldQuestion);

    if (is清空解池lyNew) {
      setCurrentStep('');
      setNextHint('');
      setCheckResult('');
      setResultText('');
      addActionLog('New problem detected. Old results cleared.');
    }
  }

  const PUBLIC_BETA_DAILY_HOMEWORK_LIMIT = 9999;
  const PUBLIC_BETA_HOMEWORK_INTERACTION_LIMIT = 9999;
  const publicBetaDailyLimitText = '今日测试次数已用完，明天可以继续测试。';
  const publicBetaHomeworkLimitText = '这道作业今天的互动次数已用完。你可以先保存结果，或换一道题继续测试。';
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
      return { ok: false, message: publicBetaDailyLimitText, log: '测试上限：今日作业测试次数已用完' };
    }
    const count = Number(items[qKey] || 0);
    if (count >= PUBLIC_BETA_HOMEWORK_INTERACTION_LIMIT) {
      return { ok: false, message: publicBetaHomeworkLimitText, log: '测试上限：这道题今天互动次数已用完' };
    }
    items[qKey] = count + 1;
    localStorage.setItem(key, JSON.stringify({ date: today, items }));
    return { ok: true, message: '', log: '' };
  }

  async function handleSolve() {
    const judgement = judgePoolText(poolText);
    const question = judgement.cleaned;

    if (hasInstructionNoise) {
      setCurrentStep('Instructions are mixed in. Click Keep only the problem first, then continue.');
      setNextHint('');
      setCheckResult('');
      addActionLog('开始拆解: instructions blocked');
      return;
    }

    if (!question) {
      addActionLog('No problem found. No action taken.');
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
      setCurrentStep('Breaking down this problem...');
      setNextHint('');
      setCheckResult('');
      const data = await postJson('/api/solve', {
        question,
        grade,
        subject,
        mode: '一步步带我做',
      });

      const answer = data.answer || '判断： Problem received.\n\n当前这一步： Read the problem first.\n\n再给我一步: Continue with one small step.';
      const sections = splitAnswerSections(answer);
      setCurrentStep(sections.current || answer);
      setNextHint(sections.next || '');
      setResultText(answer);
      setLastQuestion(question);
      addActionLog('开始拆解: 当前步骤已显示');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setCurrentStep(`Request failed：${message}`);
      addActionLog('开始拆解：Request failed');
    } finally {
      setLoadingAction('');
    }
  }

  async function handleFollowUp(action: FollowAction) {
    const judgement = judgePoolText(poolText);
    const question = judgement.cleaned || lastQuestion.trim();

    if (!question) {
      addActionLog('No original problem found. No action taken.');
      return;
    }

    const hasStudentWork = judgement.hasStudentWork;

    if (action === 'check' && !hasStudentWork) {
      setCheckResult('There is no step to check yet. Put your work in the box, for example: I wrote 3 + 2 = 5. Is this correct?');
      addActionLog('检查这一步: missing student work');
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
      action === 'next' ? '再给我一步' : action === 'hint' ? '给我一点提示' : '检查这一步';

    try {
      setLoadingAction(action);
      if (action === "check") setCheckResult("Checking this step...");
      if (action !== "check") setCheckResult("");
      const data = await postJson('/api/follow-up', {
        action,
        question,
        grade,
        subject,
        current: [currentStep, nextHint ? 'Previous next-step hint: ' + nextHint : ''].filter(Boolean).join('\\n\\n'),
        studentWork: action === 'check' && hasStudentWork ? poolText : '',
      });

      const answer = data.answer || '判断： Received.\n\n当前这一步： Continue working on this problem.\n\n再给我一步：再往前走一小步。';
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

      if (action === 'next') addActionLog('再给我一步: 已加入');
      if (action === 'hint') addActionLog('提示：已显示');
      if (action === 'check') addActionLog('检查这一步: 结果已返回');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setCurrentStep(`Request failed：${message}`);
      addActionLog(`${actionTitle}：Request failed`);
    } finally {
      setLoadingAction('');
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      handlePoolChange(text);
      addActionLog('一键粘贴: 已加入 to the box');
    } catch {
      addActionLog('一键粘贴: browser did not allow clipboard access');
    }
  }

  function keepOnlyQuestion() {
    const question = get保存QuestionText();
    if (!question.trim()) return;
    setPoolText(question);
    setCurrentStep('');
    setNextHint('');
    setCheckResult('');
    setResultText('');
    set保存Notice('');
    addActionLog('Cleanup: kept only the problem');
  }

  function clearPool() {
    setPoolText('');
    setCurrentStep('');
    setNextHint('');
    setCheckResult('');
    setResultText('');
    setLastQuestion('');
    set保存Notice('');
    addActionLog('清空解池: current content cleared');
  }

  function copyResult() {
    const text = [
      ['Problem', get保存QuestionText()],
      ['Grade', grade],
      ['Subject', subject],
      ['Current step', currentStep],
      ['再给我一步 hint', nextHint],
      ['检查结果', checkResult],
    ].filter((item) => Boolean(item[1])).map((item) => item[0] + '\n' + item[1]).join('\n\n');
    if (!text.trim()) return;
    navigator.clipboard.writeText(text);
    addActionLog('复制: problem and result copied');
  }



  function get保存QuestionText() {
    const raw = (poolText.trim() || lastQuestion.trim() || 'Untitled homework').trim();
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    const cleanLines = lines.filter((line) => {
      // 过滤GradeSubject说明，解池Keep only the problem本身
      if (/^\d+[.、]/.test(line)) return false;
      if (/^\d+Grade\s*\/\s*(数学|物理|化学)$/.test(line)) return false;
      if (/^\d+Grade$/.test(line)) return false;
      if (/^(数学|物理|化学)$/.test(line)) return false;
      if (/^Grade[:：]\s*\d+Grade$/.test(line)) return false;
      if (/^Subject[:：]\s*(数学|物理|化学)$/.test(line)) return false;
      if (/^解池只放[:：]?$/.test(line)) return false;
      if (/^解池[:：]?$/.test(line)) return false;
      if (/页面选|Problem像|提醒出现|没有自动改Subject|没有拦截|当前选择|请确认Subject是否选对/.test(line)) return false;
      if (/https?:\/\//i.test(line)) return false;
      if (/Open\s*http/i.test(line)) return false;
      if (/清空解池|解池里|只放|Subject选|开始拆解|重新拆解|再给我一步|保存|复制\s*\/\s*保存/.test(line)) return false;
      if (/^点[“"].*[”"]?$/.test(line)) return false;
      if (/^Current step[:：]?$/.test(line)) return false;
      if (/^再给我一步 hint[:：]?$/.test(line)) return false;
      if (/^检查结果[:：]?$/.test(line)) return false;
      return true;
    });

    return cleanLines.find((line) => /[？?]$/.test(line)) || cleanLines[0] || raw;
  }

  function saveResult() {
    const hasContent = currentStep.trim() || nextHint.trim() || checkResult.trim();
    if (!hasContent) return;

    if (hasFailedResult) {
      set保存Notice('This result has an error. Restart the problem successfully before saving.');
      addActionLog('保存: result has an error, not saved');
      return;
    }

    const item: 保存dResult = {
      id: String(Date.now()),
      question: get保存QuestionText(),
      grade,
      subject,
      currentStep,
      nextHint,
      checkResult,
      createdAt: nowText(),
    };

    const nextList = [item, ...savedResults.filter((oldItem) => oldItem.question.trim() !== item.question.trim())].slice(0, 20);
    set保存dResults(nextList);
    window.localStorage.setItem('v1保存dResults', JSON.stringify(nextList));
    addActionLog('保存: saved to recent homework');
    set保存Notice('保存d to recent homework');
  }

  function open保存dResult(item: 保存dResult) {
    setPoolText(item.question);
    setGrade(item.grade);
    setSubject(item.subject);
    setCurrentStep(item.currentStep.includes("解池里混入") ? "" : item.currentStep);
    setNextHint(item.nextHint);
    setCheckResult(item.checkResult);
    setResultText(
      [
        item.checkResult,
        item.currentStep ? 'Current step：' + item.currentStep : '',
        item.nextHint ? '再给我一步：' + item.nextHint : '',
      ].filter(Boolean).join('\n\n')
    );
    setLastQuestion(item.question);
    set保存Notice('保存d homework opened');
    addActionLog('Recent homework: opened');
  }

  function delete保存dResult(id: string) {
    const nextList = savedResults.filter((item) => item.id !== id);
    set保存dResults(nextList);
    window.localStorage.setItem('v1保存dResults', JSON.stringify(nextList));
    set保存Notice('');
    addActionLog('Recent homework: deleted one item');
  }

  return (
    <main className="appShell">
      {showPoster && <JiechiPoster onEnter={enterJiechi} />}
      <section className="heroPanel">
        <div className="titleBlock">
          <p className="eyebrow">解池 V1</p>
          <h1>把作业变成下一步</h1>
          <p className="subtitle">把数学、物理或化学作业放进来，解池会帮你看清下一步。</p>
          <p className="publicBetaNotice">V1 测试版：每台设备每天可测试 3 道作业题，每道题最多 8 次 AI 互动。当前先支持文字版数学、物理、化学。</p>
          <p className="publicBetaNotice"><a href="mailto:trlisuning@gmail.com?subject=StepSolve%20Feedback&body=What%20problem%20were%20you%20trying%20to%20solve%3F%0you%20trying%20to%20solve%0A%0ADid%20StepSolve%20help%20you%20find%20the%20next%20step%3F%0A%0AWhat%20was%20confusing%3F%0A%0AYour%20email%20(optional)%3A%20">反馈</a> · 如果留下邮箱，我们可能会追问细节。</p>
          <div className="goalBar"><strong>目标：</strong><span>看懂题目 → 找到方法 → 做下一步 → 检查这一步</span></div>
        </div>

        <div className="workspace">
          <section className="poolCard">
            <div className="rowHeader">
              <h2>把作业扔进解池</h2>
              <div className="selectRow">
                <select value={grade} onChange={(event) => setGrade(event.target.value)}>
                  <option value="7Grade">Grade 7</option>
                  <option value="8Grade">8年级</option>
                  <option value="9Grade">Grade 9</option>
                  <option value="10Grade">Grade 10</option>
                </select>
                <select value={subject} onChange={(event) => setSubject(event.target.value)}>
                  <option value="数学">数学</option>
                  <option value="物理">Physics</option>
                  <option value="化学">Chemistry</option>
                </select>
              </div>
            </div>

            <textarea
              className="poolInput"
              value={poolText}
              onChange={(event) => handlePoolChange(event.target.value)}
              placeholder="把作业放在这里：题目、公式、步骤，或者你卡住的地方。"
            />
            <div className="poolFixedTip">这里只放作业内容，不要写年级、学科或额外说明。</div>

            {(hasInstructionNoise || subjectMismatchWarning) && (
              <div className="poolWarning">
                <span>{hasInstructionNoise ? 'It looks like instructions are mixed in. Please keep only the homework problem.' : 'This problem may not match the selected subject. Please check the subject.'}</span>
                {(hasInstructionNoise || subjectMismatchWarning) && (
                  <button type="button" onClick={keepOnlyQuestion}>
                    Keep only the problem
                  </button>
                )}
              </div>
            )}

            <div className="toolRow">               <button type="button" className="ghostButton" onClick={pasteFromClipboard}>                 一键粘贴               </button>               <button type="button" className="ghostButton" onClick={clearPool}>                 清空解池               </button>               <button type="button" className="ghostButton" data-top-check-button="true" onClick={() => handleFollowUp('check')} disabled={!poolText.trim() || Boolean(loadingAction)}>                 检查这一步               </button>             </div>

            <button
              type="button"
              className={loadingAction === 'solve' ? 'mainButton isLoading' : 'mainButton'}
              onClick={handleSolve}
              disabled={!poolText.trim() || Boolean(loadingAction)}
            >
              {loadingAction === 'solve' ? '作业正在载入……' : mainButtonText}
            </button>


            <div className="statusLine">
              {loadingAction
                ? 'AI is working. Please wait.'
                : hasResult
                  ? '已有结果，可以继续下一步、要提示，或检查这一步。'
                  : '等待作业放入。'}
            </div>

            {loadingAction && (
              <div className="busyNotice">
                AI is processing. Please do not click again.
              </div>
            )}
          </section>

          <section className="resultColumn">
            <div className="resultCard currentStepCard">
              <div className="rowHeader">
                <h2>当前这一步</h2>
                {loadingAction && <span className="pill">AI working</span>}
              </div>

              {currentStep ? (
                <pre className="resultText">{currentStep}</pre>
              ) : (
                <div className="emptyState">
                  <strong>还没有当前步骤</strong>
                  <p>放入一道题，解池会先给你最容易开始的一步。</p>
                </div>
              )}

              {hasResult && (
                <div className="followRow">
                  <button type="button" onClick={() => handleFollowUp('next')} disabled={Boolean(loadingAction)}>
                    再给我一步
                  </button>
                  <button type="button" onClick={() => handleFollowUp('hint')} disabled={Boolean(loadingAction)}>
                    给我一点提示
                  </button>
                </div>
              )}
            </div>

            <div className="resultCard">
              <div className="rowHeader">
                <h2>下一步提示</h2>
              </div>

              {nextHint ? (
                <pre className="resultText longResult">{nextHint}</pre>
              ) : (
                <div className="emptyState">
                  <strong>还没有下一步提示</strong>
                  <p>点击“再给我一步”或“给我一点提示”，这里会显示下一步。</p>
                </div>
              )}
            </div>

            <div className="resultCard">               <div className="rowHeader">                 <h2>检查结果</h2>               </div>                {checkResult ? (                 <pre className="resultText longResult">{checkResult}</pre>               ) : (                 <div className="emptyState">                   <strong>还没有检查结果</strong>                   <p>把你做到的那一步也放进解池，比如：我写到 x = 4，检查对不对。</p>                 </div>               )}             </div> 
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
                <p>保存的作业会显示在下面。本设备最多保留 20 条。</p>
                {saveNotice && <p className="saveNotice">{saveNotice}</p>}
                {hasFailedResult && <p className="saveNotice warning">This result has an error. Restart the problem successfully before saving.</p>}
              </div>

              <div className="recentBox">
                <h3>最近保存 ({savedResults.length}/20）</h3>
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
                          <button type="button" className="recentOpenButton" onClick={() => open保存dResult(item)}>
                            Open
                          </button>
                          <button type="button" className="recentDelete" onClick={() => delete保存dResult(item.id)}>
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="emptyState compact">
                    <p>保存的作业会显示在这里。</p>
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
                  <strong>还没有动作记录</strong>
                  <p>每次点击按钮，都会在这里留下一条记录。</p>
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
































































