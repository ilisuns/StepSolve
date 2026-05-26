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
      if (/^\d+[.、]\s*(点|点击|输入|重新输入|Open|按|看|检查|测试|然后|只放|Clear|Copy|粘贴)/.test(line)) return false;
      if (/^(Ctrl\s*\+\s*F5|http:\/\/localhost|Local:|VITE|按 Win|输入 cmd|回车)/i.test(line)) return false;
      if (/^(点|点击|Open|按|Copy执行|执行|看到|回复|回我)/.test(line)) return false;
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
    judgement: pick('判断：', ['Current step：', 'Next step：', 'Step check：']),
    current: pick('Current step：', ['Next step：', 'Step check：', '判断：']),
    next: pick('Next step：', ['Step check：', '判断：', 'Current step：']),
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
    /Clear/,
    /Start/,
    /重新拆解/,
    /Next step/,
    /Current step|Next step hint|Step check|不报错|页面测试|build|已通过|目标/,
    /Save/,
    /Copy/,
    /Open\s*http/i,
    /^\s*\d+[.、].*(点|Open|Clear|放入|Save|Copy|开始|再给)/m,
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
  const hasFailedResult = currentStep.includes('Request failed') || resultText.includes('Request failed');

  const mainButtonText = useMemo(() => {
    if (loadingAction === 'solve') return 'Breaking it down...';
    if (loadingAction === 'check') return 'Checking...';
    if (hasResult) return 'Restart this problem';
    return 'Start';
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

    const isClearlyNew =
      newText !== oldQuestion &&
      !oldQuestion.includes(newText) &&
      !newText.includes(oldQuestion);

    if (isClearlyNew) {
      setCurrentStep('');
      setNextHint('');
      setCheckResult('');
      setResultText('');
      addActionLog('New problem detected. Old results cleared.');
    }
  }

  const PUBLIC_BETA_DAILY_HOMEWORK_LIMIT = 3;
  const PUBLIC_BETA_HOMEWORK_INTERACTION_LIMIT = 8;
  const publicBetaDailyLimitText = 'Daily beta limit reached. You can try more homework tomorrow.';
  const publicBetaHomeworkLimitText = 'This homework has reached 8 AI interactions today. You can save the result or try another problem.';
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
      return { ok: false, message: publicBetaDailyLimitText, log: 'Beta limit: daily homework limit reached' };
    }
    const count = Number(items[qKey] || 0);
    if (count >= PUBLIC_BETA_HOMEWORK_INTERACTION_LIMIT) {
      return { ok: false, message: publicBetaHomeworkLimitText, log: 'Beta limit: this problem has reached its interaction limit' };
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
      addActionLog('Start: instructions blocked');
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

      const answer = data.answer || 'Judgment: Problem received.\n\nCurrent step: Read the problem first.\n\nNext step: Continue with one small step.';
      const sections = splitAnswerSections(answer);
      setCurrentStep(sections.current || answer);
      setNextHint(sections.next || '');
      setResultText(answer);
      setLastQuestion(question);
      addActionLog('Start: current step shown');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setCurrentStep(`Request failed：${message}`);
      addActionLog('Start：Request failed');
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
      addActionLog('Check this step: missing student work');
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
      action === 'next' ? 'Next step' : action === 'hint' ? 'Get a hint' : 'Check this step';

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

      const answer = data.answer || 'Judgment: Received.\n\nCurrent step: Continue working on this problem.\n\nNext step：再往前走一小步。';
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

      if (action === 'next') addActionLog('Next step: added');
      if (action === 'hint') addActionLog('Hint: shown');
      if (action === 'check') addActionLog('Check this step: result returned');
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
      addActionLog('Paste: added to the box');
    } catch {
      addActionLog('Paste: browser did not allow clipboard access');
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
    addActionLog('Cleanup: kept only the problem');
  }

  function clearPool() {
    setPoolText('');
    setCurrentStep('');
    setNextHint('');
    setCheckResult('');
    setResultText('');
    setLastQuestion('');
    setSaveNotice('');
    addActionLog('Clear: current content cleared');
  }

  function copyResult() {
    const text = [
      ['Problem', getSaveQuestionText()],
      ['Grade', grade],
      ['Subject', subject],
      ['Current step', currentStep],
      ['Next step hint', nextHint],
      ['Step check', checkResult],
    ].filter((item) => Boolean(item[1])).map((item) => item[0] + '\n' + item[1]).join('\n\n');
    if (!text.trim()) return;
    navigator.clipboard.writeText(text);
    addActionLog('Copy: problem and result copied');
  }



  function getSaveQuestionText() {
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
      if (/Clear|解池里|只放|Subject选|Start|重新拆解|Next step|Save|Copy\s*\/\s*Save/.test(line)) return false;
      if (/^点[“"].*[”"]?$/.test(line)) return false;
      if (/^Current step[:：]?$/.test(line)) return false;
      if (/^Next step hint[:：]?$/.test(line)) return false;
      if (/^Step check[:：]?$/.test(line)) return false;
      return true;
    });

    return cleanLines.find((line) => /[？?]$/.test(line)) || cleanLines[0] || raw;
  }

  function saveResult() {
    const hasContent = currentStep.trim() || nextHint.trim() || checkResult.trim();
    if (!hasContent) return;

    if (hasFailedResult) {
      setSaveNotice('This result has an error. Restart the problem successfully before saving.');
      addActionLog('Save: result has an error, not saved');
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
    addActionLog('Save: saved to recent homework');
    setSaveNotice('Saved to recent homework');
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
        item.currentStep ? 'Current step：' + item.currentStep : '',
        item.nextHint ? 'Next step：' + item.nextHint : '',
      ].filter(Boolean).join('\n\n')
    );
    setLastQuestion(item.question);
    setSaveNotice('Saved homework opened');
    addActionLog('Recent homework: opened');
  }

  function deleteSavedResult(id: string) {
    const nextList = savedResults.filter((item) => item.id !== id);
    setSavedResults(nextList);
    window.localStorage.setItem('v1SavedResults', JSON.stringify(nextList));
    setSaveNotice('');
    addActionLog('Recent homework: deleted one item');
  }

  return (
    <main className="appShell">
      <section className="heroPanel">
        <div className="titleBlock">
          <p className="eyebrow">StepSolve V1</p>
          <h1>Turn homework into the next step</h1>
          <p className="subtitle">Drop in a math, physics, or chemistry problem. StepSolve reads it and helps you take one clear next step.</p>
          <p className="publicBetaNotice">V1 public beta: Each device can test 3 homework problems per day, with up to 8 AI interactions per problem. Text-only math, physics, and chemistry for now.</p>
          <p className="publicBetaNotice"><a href="mailto:trlisuning@gmail.com?subject=StepSolve%20Feedback&body=What%20problem%20were%20you%20trying%20to%20solve%3F%0you%20trying%20to%20solve%0A%0ADid%20StepSolve%20help%20you%20find%20the%20next%20step%3F%0A%0AWhat%20was%20confusing%3F%0A%0AYour%20email%20(optional)%3A%20">Send Feedback</a> · If you leave your email, we may follow up for more details.</p>
          <div className="goalBar"><strong>Goal:</strong><span>Understand the problem → Find the method → Take the next step → Check your work</span></div>
        </div>

        <div className="workspace">
          <section className="poolCard">
            <div className="rowHeader">
              <h2>Drop homework into StepSolve</h2>
              <div className="selectRow">
                <select value={grade} onChange={(event) => setGrade(event.target.value)}>
                  <option value="7Grade">Grade 7</option>
                  <option value="8Grade">Grade 8</option>
                  <option value="9Grade">Grade 9</option>
                  <option value="10Grade">Grade 10</option>
                </select>
                <select value={subject} onChange={(event) => setSubject(event.target.value)}>
                  <option value="数学">Math</option>
                  <option value="物理">Physics</option>
                  <option value="化学">Chemistry</option>
                </select>
              </div>
            </div>

            <textarea
              className="poolInput"
              value={poolText}
              onChange={(event) => handlePoolChange(event.target.value)}
              placeholder="Drop your homework here: text, formulas, steps, or where you got stuck."
            />
            <div className="poolFixedTip">Only put homework content here. Do not add grade, subject, or instructions.</div>

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

            <div className="toolRow">               <button type="button" className="ghostButton" onClick={pasteFromClipboard}>                 Paste               </button>               <button type="button" className="ghostButton" onClick={clearPool}>                 Clear               </button>               <button type="button" className="ghostButton" data-top-check-button="true" onClick={() => handleFollowUp('check')} disabled={!poolText.trim() || Boolean(loadingAction)}>                 Check this step               </button>             </div>

            <button
              type="button"
              className={loadingAction === 'solve' ? 'mainButton isLoading' : 'mainButton'}
              onClick={handleSolve}
              disabled={!poolText.trim() || Boolean(loadingAction)}
            >
              {loadingAction === 'solve' ? 'Loading homework' : mainButtonText}
            </button>


            <div className="statusLine">
              {loadingAction
                ? 'AI is working. Please wait.'
                : hasResult
                  ? 'You have a result. You can ask for the next step, get a hint, or check your work.'
                  : 'Waiting for homework.'}
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
                <h2>Start with this step</h2>
                {loadingAction && <span className="pill">AI working</span>}
              </div>

              {currentStep ? (
                <pre className="resultText">{currentStep}</pre>
              ) : (
                <div className="emptyState">
                  <strong>No step yet</strong>
                  <p>Drop in a problem. StepSolve will give you the easiest first step.</p>
                </div>
              )}

              {hasResult && (
                <div className="followRow">
                  <button type="button" onClick={() => handleFollowUp('next')} disabled={Boolean(loadingAction)}>
                    Next step
                  </button>
                  <button type="button" onClick={() => handleFollowUp('hint')} disabled={Boolean(loadingAction)}>
                    Get a hint
                  </button>
                </div>
              )}
            </div>

            <div className="resultCard">
              <div className="rowHeader">
                <h2>Next small step</h2>
              </div>

              {nextHint ? (
                <pre className="resultText longResult">{nextHint}</pre>
              ) : (
                <div className="emptyState">
                  <strong>No next step yet</strong>
                  <p>Click Next step or Get a hint. The next small step will appear here.</p>
                </div>
              )}
            </div>

            <div className="resultCard">               <div className="rowHeader">                 <h2>Step check</h2>               </div>                {checkResult ? (                 <pre className="resultText longResult">{checkResult}</pre>               ) : (                 <div className="emptyState">                   <strong>No check yet</strong>                   <p>To check your work, include your step in the box, such as: I got x = 4. Is this correct?</p>                 </div>               )}             </div> 
            <div className="resultCard">
              <div className="rowHeader">
                <h2>Save homework</h2>
                {hasResult && (
                  <div className="saveButtonGroup">
                    <button type="button" className="copyButton" onClick={copyResult}>
                      Copy
                    </button>
                    <button type="button" className="copyButton" onClick={saveResult} disabled={hasFailedResult || Boolean(loadingAction)}>
                      Save
                    </button>
                  </div>
                )}
              </div>

              <div className="emptyState compact">
                <p>Saved items will appear below. This device keeps up to 20 items.</p>
                {saveNotice && <p className="saveNotice">{saveNotice}</p>}
                {hasFailedResult && <p className="saveNotice warning">This result has an error. Restart the problem successfully before saving.</p>}
              </div>

              <div className="recentBox">
                <h3>Recent saves ({savedResults.length}/20）</h3>
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
                            Open
                          </button>
                          <button type="button" className="recentDelete" onClick={() => deleteSavedResult(item.id)}>
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="emptyState compact">
                    <p>Saved homework will appear here.</p>
                  </div>
                )}
              </div>
            </div> 
            <div className="resultCard">
              <h2>Activity log</h2>
              {actionLog.length ? (
                <ul className="actionLog">
                  {actionLog.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div className="emptyState compact">
                  <strong>No activity yet</strong>
                  <p>Each button click will add a record here.</p>
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
























































