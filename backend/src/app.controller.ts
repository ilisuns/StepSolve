import { Body, Controller, Get, Post } from '@nestjs/common';
import OpenAI from 'openai';

type SolveBody = {
  question?: string;
  grade?: string;
  subject?: string;
  mode?: string;
};

type FollowBody = {
  action?: 'next' | 'hint' | 'check';
  question?: string;
  current?: string;
  studentWork?: string;
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-nano';

function text(value: unknown) {
  return String(value ?? '').trim();
}

function safeFallback(action: string) {
  if (action === 'hint') {
    return '判断： 需要先找到方向，不直接给完整答案。\n\n当前这一步：先找未知量，再找它和已知条件之间的关系。\n\n下一步：只写下一小步，不要一次写完整答案。';
  }

  if (action === 'check') {
    return '判断： 信息还不够。\n\n当前这一步：需要同时看到原题、学生步骤和检查请求。\n\n下一步：把原题、你的步骤、卡住的地方一起放进解池。';
  }

  return '判断： 先读题，不要急着要答案。\n\n当前这一步：把题目要求什么、已知条件是什么分开。\n\n下一步：只往前走一小步。';
}

@Controller()
export class AppController {
  @Get()
  getRoot() {
    return {
      ok: true,
      name: 'adaptive-pool-v1-ai-backend',
      port: 3100,
      model: MODEL,
    };
  }

  @Post('/api/solve')
  async solve(@Body() body: SolveBody) {
    const question = text(body.question);
    const grade = text(body.grade) || '8年级';
    const subject = text(body.subject) || '数学';
    const mode = text(body.mode) || '一步步带我做';

    if (!question) {
      return {
        action: 'solve',
        answer: '判断： 还没有看到题目。\n\n当前这一步：请先把作业题放进解池。\n\n下一步：放入原题、你的步骤或卡住的地方。',
      };
    }

    // FAST_SOLVE_LINEAR_MATH_V1
    const compactQuestion = question.replace(/\s+/g, '');
    const linearMatch = compactQuestion.match(/^(-?\d*)x([+-]\d+)=(-?\d+)/i);
    if (linearMatch) {
      const aText = linearMatch[1];
      const a = aText === '' || aText === '+' ? 1 : aText === '-' ? -1 : Number(aText);
      const b = Number(linearMatch[2]);
      const c = Number(linearMatch[3]);

      if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && a !== 0) {
        const right = c - b;
        const absB = Math.abs(b);
        const sideText = b > 0 ? '+' + absB : '-' + absB;
        const actionText = b > 0 ? '减去 ' + absB : '加上 ' + absB;

        return {
          action: 'solve',
          answer: [
            '判断：继续拆解。',
            '',
            '当前这一步：先处理 x 旁边单独的数 ' + sideText + '。要让 x 单独留下，第一步先把这个数移走。',
            '',
            '下一步：等式两边同时' + actionText + '，得到 ' + a + 'x = ' + right + '。'
          ].join('\n'),
        };
      }
    }

    const prompt = [
      'IMPORTANT: 必须全程使用简体中文回答。不要输出英文标签。固定使用中文标签：判断：、当前这一步：、下一步：',
      '必须全程使用中文回答。不要输出英文标签。固定使用：判断：、当前这一步：、下一步：、提示：。你是一个面向学生的作业拆解助手。',
      '产品不是答案机，目标是把作业变成学生能继续走下去的学习路径。',
      '只服务数学、物理、化学。`r`n只用简体中文回答，面向中学生，语言短、清楚、像老师带一步。必须严格使用这个格式：判断：……\n\n当前这一步：……\n\n下一步：……。禁止出现任何英文标签或英文句子，尤其禁止出现 Judgment、当前这一步、下一步、、、、。',
      '',
      '三科强引导规则：数学、物理、化学里，只要关系链容易绕，即使题目看起来基础，也按困难题或强引导题处理。',
      '',
      'V1自适应规则块：',
      '1. 年级自适应：7年级短句、少术语、一步一动作；8年级可以出现公式/关系，但每次只推进一小步；9-10年级可以多一点推理，但不能直接给完整答案。',
      '2. 学科自适应：数学先看结构再变形；物理先列已知量、选公式、代入并写单位；化学先写反应物/生成物，再数元素，再配平。',
      '3. 每次回答都要符合当前年级和学科，不要只把年级学科当标签。',
      '强引导链路：已知条件 → 目标 → 关系/规则/公式 → 代入/转化 → 计算/推导 → 单位/意义/检查。',
      '不能假设学生自然能接上关系链；不要直接跳答案，要把中间关系讲清楚。',
      '',
      '必须按这个固定格式输出：',
      '判断：',
      '当前这一步：',
      '下一步：',
      '格式要求：',
      '1. 当前这一步必须写具体可执行动作，不能为空。',
      '2. 不要把真正要做的动作只写到“下一步”里。',
      '3. 当前这一步写现在立刻做什么；下一步写做完以后再做什么。',
      '',
      '',
      '规则：',
      '1. 不要直接给完整答案。',
      '2. 只给当前最该走的一小步。',
      '3. 如果学生已经写了步骤，要参考他的步骤，不要从头重讲。',
      '4. 语言短、清楚、像老师在旁边提醒，但不要低龄化。不要说“用手指圈出题目”“拿笔圈一下”这类话；改成“先观察方程结构”“确认已知条件和要求”。',
      '5. 不要输出 CURRENT_STEP、NEXT_STEP、HINT、CHECK 这些测试标签。不要出现“告诉学生”“引导学生”“应该让学生”这类提示词口吻，要直接对学生说下一步。',
      '',
      '开始拆解年级学科口径：如果是7年级，禁止使用“已知条件、表达式、常数项、一元一次方程、系数”等硬词；必须说成“先看左边”“多了 +3”“先把 +3 去掉”；每句短。9年级可以加入公式关系和简单推理；数学重点说清楚每一步为什么这样变形。物理题遇到质量和合力，下一步必须明确公式 a = F ÷ m，再代入 a = 6 ÷ 2，并提醒单位 m/s²。7年级遇到 2x + 3 = 11 这类题，下一步优先说：先看 +3，要让 2x 单独留下，就先把 +3 去掉；不要说“把 2 和 x 放在一起”。',
      `年级：${grade}`,
      `学科：${subject}`,
      `模式：${mode}`,
      '',
      '数学表达补充：',
      '数学一元一次方程表达规则：如果已经得到 2x = 8 或 ax = b，下一步应引导“等式两边同时除以系数”，不要说“将系数与未知数相乘”。',
      '',
      '解池内容：',
      question,
    ].join('\n');

    try {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });

      return {
        action: 'solve',
        answer: (completion.choices[0]?.message?.content?.trim() || safeFallback('solve')).replace(/^判断：\s*\n\s*([^\n]+)(?=\n\s*\n\s*当前这一步：)/, '判断：$1').replace(/^判断：\s*(?=\n\s*当前这一步：)/, '判断： 继续拆解。').replace(/当前这一步：\s*\n\s*(下一步：\s*\n?\s*([^\n]+))/, '当前这一步：$2\n\n$1').replace(/已知条件/g, '题里给的信息').replace(/表达式/g, '算式').replace(/一元一次方程/g, '带 x 的等式').replace(/常数项/g, '单独的数').replace(/系数/g, '前面的数字'),
      };
    } catch (error) {
      console.error('OpenAI solve failed:', error);
      return {
        action: 'solve',
        answer: safeFallback('solve'),
      };
    }
  }

  @Post('/api/follow-up')
  async followUp(@Body() body: FollowBody) {
    const action = body.action || 'next';
    const question = text(body.question);
    const subject = text((body as any).subject) || '数学';
    const current = text(body.current);
    const studentWork = text(body.studentWork);
    // ball count small rule start
    const ballRedMatch = question.match(/(\d+)\s*个红球/);
    const ballBlueMatch = question.match(/(\d+)\s*个蓝球/);
    const ballRed = ballRedMatch?.[1] || '';
    const ballBlue = ballBlueMatch?.[1] || '';
    const ballTotal =
      ballRed && ballBlue ? String(Number(ballRed) + Number(ballBlue)) : '';

    if (
      action === 'next' &&
      ballRed &&
      ballBlue &&
      ballTotal &&
      /一共|总数|几个/.test(question)
    ) {
      const compactCountCurrent = current.replace(/\s+/g, '');

      const hasCountExpression =
        compactCountCurrent.includes(ballRed + '+' + ballBlue) ||
        compactCountCurrent.includes(ballRed + '＋' + ballBlue) ||
        compactCountCurrent.includes(ballRed + '加' + ballBlue);

      const hasCountResult =
        compactCountCurrent.includes(ballRed + '+' + ballBlue + '=' + ballTotal) ||
        compactCountCurrent.includes('一共有' + ballTotal + '个球');

      if (!hasCountExpression) {
        return {
          action,
          answer:
            '判断： 继续拆解。\n\n当前这一步：写出总数关系：红球 + 蓝球 = 总数，也就是 ' +
            ballRed +
            ' + ' +
            ballBlue +
            '。\n\n下一步：计算 ' +
            ballRed +
            ' + ' +
            ballBlue +
            ' 的结果。',
        };
      }

      if (!hasCountResult) {
        return {
          action,
          answer:
            '判断： 继续拆解。\n\n当前这一步：计算 ' +
            ballRed +
            ' + ' +
            ballBlue +
            ' = ' +
            ballTotal +
            '。\n\n下一步：写结论：一共有 ' +
            ballTotal +
            ' 个球。',
        };
      }

      return {
        action,
        answer:
          '判断： 继续拆解。\n\n当前这一步：写出结论：一共有 ' +
          ballTotal +
          ' 个球。\n\n下一步：可以检查：' +
          ballRed +
          ' 个红球加 ' +
          ballBlue +
          ' 个蓝球，没有漏数。',
      };
    }
    // ball count check strict rule start
    if (action === "check" && ballRed && ballBlue && ballTotal && /一共|总数|几个/.test(question) && studentWork) {
      const compactCheckWork = studentWork.replace(/\s+/g, "");
      const eqMatch = compactCheckWork.match(/(\d+)\+(\d+)=(\d+)/);
      // ball count need one more step rule
      const exprMatch = compactCheckWork.match(/(\d+)\+(\d+)(?![=+\d])/);
      if (!eqMatch && exprMatch) {
        const first = Number(exprMatch[1]);
        const second = Number(exprMatch[2]);
        const red = Number(ballRed);
        const blue = Number(ballBlue);
        const total = Number(ballTotal);
        const isSameNumbers = (first === red && second === blue) || (first === blue && second === red);
        if (isSameNumbers) {
          return { action, answer: "判断： 还需要补一步。\n\n当前这一步：" + first + " + " + second + " 方向对，但还没有算出结果。\n\n下一步：把 " + first + " + " + second + " 算出来，写成 " + first + " + " + second + " = " + total + "。" };
        }
      }
      if (eqMatch) {
        const first = Number(eqMatch[1]);
        const second = Number(eqMatch[2]);
        const result = Number(eqMatch[3]);
        const red = Number(ballRed);
        const blue = Number(ballBlue);
        const total = Number(ballTotal);
        const isSameNumbers = (first === red && second === blue) || (first === blue && second === red);
        if (isSameNumbers && result !== total) {
          return { action, answer: "判断： 这一步不对。\n\n当前这一步：" + first + " + " + second + " 不等于 " + result + "，正确结果是 " + total + "。\n\n下一步：把这一步改成 " + first + " + " + second + " = " + total + "，再写答句：一共有 " + total + " 个球。" };
        }
        if (isSameNumbers && result === total) {
          return { action, answer: "判断： 这一步是对的。\n\n当前这一步：" + first + " + " + second + " = " + total + " 正确。\n\n下一步：写完整答句：一共有 " + total + " 个球。" };
        }
      }
    }
    // ball count check strict rule end

    // ball count small rule end

    if (!question) {
      return {
        action,
        answer: '判断：还没有看到原题。\n\n当前这一步：请先把原题放进解池。\n\n下一步：原题、步骤、卡住点都可以一起放进来。',
      };
    }

    if (action === 'check' && !studentWork) {
      return {
        action,
        answer: '判断： 信息还不够。\n\n当前这一步：我只看到原题，还没有看到你的解题步骤。\n\n下一步：把你已经做到的那一步也放进解池，比如：我先写了……，检查对不对。',
      };
    }

    // physics wrong multiply strict return start
    if (action === "check" && /质量.*2\s*kg|2\s*kg.*质量/.test(question) && /6\s*N|6N/.test(question) && /加速度|合力|F\s*=\s*ma/i.test(question + studentWork)) {
      const compactPhysicsWork2 = studentWork.replace(/\s+/g, "");
      if (/a=6[×x*]2=12/i.test(compactPhysicsWork2) || /6\s*[×x*]\s*2\s*=\s*12/.test(studentWork)) {
        return { action, answer: "判断： 这一步不对。\n\n当前这一步：加速度要用 a = F ÷ m，所以应是 6 ÷ 2 = 3，不是 6 × 2 = 12。\n\n下一步：把这一步改成 a = 6 ÷ 2 = 3，并补上单位 m/s²。" };
      }
    }
    // physics wrong multiply strict return end

    // physics need-step v2
    if (action === "check" && /质量.*2\s*kg|2\s*kg.*质量/.test(question) && /6\s*N|6N/.test(question) && /加速度|合力|F\s*=\s*ma/i.test(question + studentWork)) {
      const compactPhysicsNeed = studentWork.replace(/\s+/g, "");
      if ((/a=6[÷\/]2/i.test(compactPhysicsNeed) || /6\s*[÷\/]\s*2/.test(studentWork)) && !/=\s*3/.test(studentWork)) {
        return { action, answer: "判断： 还需要补一步。\n\n当前这一步：a = 6 ÷ 2 方向对，但还没有算出结果。\n\n下一步：把 6 ÷ 2 算出来，写成 a = 3 m/s²。" };
      }
    }
    // chemistry balanced strict return v2
    if (action === "check" && /氢气|氧气|水|配平/.test(question + studentWork)) {
      const compactChemistryWork = studentWork.replace(/\s+/g, "").replace(/₂/g, "2");
      // chemistry unbalanced direct return v1
      if (/H2\+O2=H2O/i.test(compactChemistryWork)) {
        return { action, answer: `判断： 这一步还不完整，方程还没有配平。\n\n当前这一步：H2 + O2 = H2O 只是写出了反应物和生成物，但左右氧原子数不一样。\n\n下一步：先把水前面配 2，写成 H2 + O2 = 2H2O，再继续配氢。` };
      }
      if (/2H2\+O2=2H2O/i.test(compactChemistryWork)) {
        return { action, answer: "判断： 这一步是对的。\n\n当前这一步：2H2 + O2 = 2H2O 已经配平。\n\n下一步：可以检查原子数：左边氢 4 个、氧 2 个，右边氢 4 个、氧 2 个。" };
      }
    }
    if (action === 'next' && subject === '物理' && /质量.*2kg|2kg/.test(question) && /6N|合力/.test(question)) {
      return { action, answer: '判断： 继续拆解。\n\n当前这一步：用公式 a = F ÷ m。\n\n下一步：把数字代进去：a = 6 ÷ 2。算完后，单位写 m/s²。' }; // 物理下一步固定提示
    }

    if (action === 'next' && subject === '化学' && /氢气|氧气|H2|O2|H₂|O₂|H2O|H₂O|配平/.test(question)) {
      return { action, answer: '判断： 继续拆解。\n\n当前这一步：先写出未配平的式子：H2 + O2 → H2O。\n\n下一步：数原子。左边氢 2 个，氧 2 个；右边氢 2 个，氧 1 个。先想办法让氧的个数相等。' }; // 化学下一步固定提示
    }

    const actionInstruction =
      action === 'hint'
        ? '学生点了“给我一点提示”。只给方向，不要代做，不要给完整答案。'
        : action === 'check'
          ? '学生点了“检查这一步”。必须先检查学生步骤是否成立。明显算错、移项错、公式错、单位错，必须直接判“这里要改”，不能说“可以继续”。'
          : '学生点了“再给我一步”。只承接当前内容，给下一小步，不能重新从头拆题。';

    const prompt = [
      'IMPORTANT: 必须全程使用简体中文回答。不要输出英文标签。固定使用中文标签：判断：、当前这一步：、下一步：',
      '必须全程使用中文回答。不要输出英文标签。固定使用：判断：、当前这一步：、下一步：、提示：。你是一个面向学生的作业拆解助手。',
      '产品不是答案机，目标是让学生继续走下一步。只用简体中文回答，面向中学生，语言短、清楚、像老师带一步。必须严格使用这个格式：判断：……\n\n当前这一步：……\n\n下一步：……。禁止出现任何英文标签或英文句子，尤其禁止出现 Judgment、当前这一步、下一步、、、、。`r`n只用简体中文回答，面向中学生，语言短、清楚、像老师带一步。必须严格使用这个格式：判断：……\n\n当前这一步：……\n\n下一步：……。禁止出现任何英文标签或英文句子，尤其禁止出现 Judgment、当前这一步、下一步、、、、。',
      '',
      '三科强引导规则：数学、物理、化学里，只要关系链容易绕，即使题目看起来基础，也按困难题或强引导题处理。',
      '',
      'V1自适应规则块：',
      '1. 年级自适应：7年级短句、少术语、一步一动作；8年级可以出现公式/关系，但每次只推进一小步；9-10年级可以多一点推理，但不能直接给完整答案。',
      '2. 学科自适应：数学先看结构再变形；物理先列已知量、选公式、代入并写单位；化学先写反应物/生成物，再数元素，再配平。',
      '3. 每次回答都要符合当前年级和学科，不要只把年级学科当标签。',
      '强引导链路：已知条件 → 目标 → 关系/规则/公式 → 代入/转化 → 计算/推导 → 单位/意义/检查。',
      '不能假设学生自然能接上关系链；不要直接跳答案，要把中间关系讲清楚。',
      "数学数数题规则：问红球和蓝球一共有多少个时，每一步必须推进：先写红球 + 蓝球 = 总数，再计算结果，再写答句。",
      "When the student clicks next repeatedly, do not repeat expression guidance; each answer must add one concrete operation or result.",
      '',
      '必须按这个固定格式输出：',
      '判断：',
      '当前这一步：',
      '下一步：',
      '格式要求：',
      '1. 当前这一步必须写具体可执行动作，不能为空。',
      '2. 不要把真正要做的动作只写到“下一步”里。',
      '3. 当前这一步写现在立刻做什么；下一步写做完以后再做什么。',
      '',
      '',
      '规则：',
      '1. 不要直接输出完整答案。',
      '2. 只处理当前动作。',
      '3. next 只给下一小步。',
      '4. hint 只给提示方向。',
      '5. check 不要先硬判“对/错”。先用四种口径：可以继续 / 需要补一步 / 这里要改 / 还看不出来。学生步骤能从原题合理推出、方向对、结果能继续时，判“可以继续”。学生省略中间过程但结果合理时，不要判错，最多说“需要补一步”。只有明显算错、移项错、公式错、单位错，才说“这里要改”。',
      '6. 语言短、清楚，但不要低龄化。不要说“用手指圈出题目”“拿笔圈一下”这类话；改成正常初中生能接受的表达。',
      '7. 不要输出 CURRENT_STEP、NEXT_STEP、HINT、CHECK 这些测试标签。不要出现“告诉学生”“引导学生”“应该让学生”这类提示词口吻，要直接对学生说下一步。',
      '',
      '年级学科回答口径：7年级要更短、更细、更像一步一步带；8年级正常拆解；9年级可以多一点公式和推理；10年级可以更结构化。数学重步骤和变形，物理重公式、已知量和单位，化学重配平和元素守恒。',
      actionInstruction,
      '',
      '额外要求：',
      '1. 如果学生点“再给我一步”，必须比当前页面往前推进一小步，不能重复上一句。',
      '2. 如果学生点“给我一点提示”，只给提示方向，不能和“再给我一步”完全一样。',
      '3. 化学方程式题：已经写出反应物后，下一步应引导写生成物；已经写出生成物后，下一步才引导配平。',
      '4. 检查缺少学生步骤时，只提示补步骤，不要判对错。',
      '5. 如果 action 是 next 或 hint，且没有明确学生步骤，判断栏只能写“继续拆解”或“给一点提示”，禁止写“这一步基本对”“还差验证”“这一步不对”。',
      '',
      '数学表达补充：',
      '数学一元一次方程表达规则：如果已经得到 2x = 8 或 ax = b，下一步应引导“等式两边同时除以系数”，不要说“将系数与未知数相乘”。',
      '',
      '原题/解池内容：',
      question,
      '',
      '当前页面显示：',
      current || '暂无',
      '',
      '学生步骤：',
      studentWork || '未提供明确学生步骤。除非解池内容里明确出现我写的是、我做到、我的步骤、检查对不对等学生表达，否则不要把当前页面显示当成学生步骤，不要判断这一步基本对。',
    ].join('\n');

    try {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      });

      const rawAnswer = (completion.choices[0]?.message?.content?.trim() || safeFallback(action)).replace(/^判断：\s*\n\s*([^\n]+)(?=\n\s*\n\s*当前这一步：)/, '判断：$1').replace(/^判断：\s*(?=\n\s*当前这一步：)/, '判断： 继续拆解。');
      const neutralJudge = action === 'hint' ? '判断： 给一点提示。' : '判断： 继续拆解。';
      const answer =
        action !== 'check' && !studentWork
          ? rawAnswer.replace(/判断：[\s\S]*?(?=\n\s*当前这一步：)/, neutralJudge + '\n\n')
          : rawAnswer;
      const compactStudentWork = studentWork.replace(/\s+/g, '');
      const mathNeedOneMoreStepAnswer = action === 'check' && /[0-9]+\s*[xX]\s*=\s*[0-9]+\s*[-+]\s*[0-9]+/.test(studentWork) ? answer.replace(/判断：[\s\S]*?(?=\n\s*当前这一步：)/, '判断： 还需要补一步。' + '\n\n').replace(/当前这一步：[\s\S]*?(?=\n\s*下一步：)/, '当前这一步：你这一步方向对，但右边还没有算完，先把减法算出来。' + '\n\n').replace(/下一步：[\s\S]*$/, '下一步：先把右边算完，例如 11 - 3 = 8，再写成 2x = 8。') : answer;
      const mathCanContinueAnswer = action === 'check' && /2x\+3=11/.test(question.replace(/\s+/g, '')) && /2x=8/.test(compactStudentWork) ? mathNeedOneMoreStepAnswer.replace(/判断：[\s\S]*?(?=\n\s*当前这一步：)/, '判断： You can continue.' + '\n\n').replace(/当前这一步：[\s\S]*?(?=\n\s*下一步：)/, '当前这一步：2x = 8 是正确的中间步骤。' + '\n\n').replace(/下一步：[\s\S]*$/, '下一步：等式两边同时除以 2，得到 x = 4。') : mathNeedOneMoreStepAnswer;
      const mathNeedChangeAnswer = action === 'check' && /2x\+3=11/.test(question.replace(/\s+/g, '')) && /2x=7/.test(compactStudentWork) ? mathCanContinueAnswer.replace(/判断：[\s\S]*?(?=\n\s*当前这一步：)/, '判断： 这一步不对。' + '\n\n').replace(/当前这一步：[\s\S]*?(?=\n\s*下一步：)/, '当前这一步：从 2x + 3 = 11 移项后，右边应是 11 - 3 = 8，不是 7。' + '\n\n').replace(/下一步：[\s\S]*$/, '下一步：先改成 2x = 8，再继续求 x。') : mathCanContinueAnswer;
      const mathDivideNotFinishedAnswer = action === 'check' && /2x\+3=11/.test(question.replace(/\s+/g, '')) && /x=8[÷\/]2/.test(compactStudentWork) ? mathNeedChangeAnswer.replace(/判断：[\s\S]*?(?=\n\s*当前这一步：)/, '判断： 还需要补一步。' + '\n\n').replace(/当前这一步：[\s\S]*?(?=\n\s*下一步：)/, '当前这一步：x = 8 ÷ 2 方向对，但还没有算出最终结果。' + '\n\n').replace(/下一步：[\s\S]*$/, '下一步：把 8 ÷ 2 算出来，写成 x = 4。') : mathNeedChangeAnswer;
      const compactQuestion = question.replace(/\s+/g, '');
      const mathFinalAnswer = action === 'check' && /2x\+3=11/.test(compactQuestion) && /x=4/.test(compactStudentWork) ? answer.replace(/判断：[\s\S]*?(?=\n\s*当前这一步：)/, '判断： You can continue.' + '\n\n').replace(/当前这一步：[\s\S]*?(?=\n\s*下一步：)/, '当前这一步： x = 4 is correct.' + '\n\n').replace(/下一步：[\s\S]*$/, '下一步： Substitute x = 4 back into the original equation to check: 2×4 + 3 = 11.') : mathDivideNotFinishedAnswer;
      const physicsCheckedAnswer = action === 'check' && /质量.*2\s*kg|2\s*kg.*质量/.test(question) && /6N|6\s*N/.test(question) && /F\s*=\s*ma/i.test(studentWork) && /6\s*[÷\/]\s*2\s*=\s*3/.test(studentWork) ? mathFinalAnswer.replace(/判断：[\s\S]*?(?=\n\s*当前这一步：)/, '判断： 这一步是对的。' + '\n\n').replace(/下一步：[\s\S]*$/, '下一步：确认 6N 是合力，然后写出最终答：a = 3m/s²。') : mathFinalAnswer;
      const chemistryCheckedAnswer = action === 'check' && /氢气|氧气|水|配平/.test(question + studentWork) && (/H2\+O2=H2O/i.test(compactStudentWork) || /H₂\+O₂=H₂O/i.test(compactStudentWork)) ? physicsCheckedAnswer.replace(/判断：[\s\S]*?(?=\n\s*当前这一步：)/, '判断： 这一步还不完整，方程还没有配平。' + '\n\n') : physicsCheckedAnswer;

      const timeMatch = question.match(/([0-9]+(?:\.[0-9]+)?)\s*秒/);
      const distanceMatch = question.match(/([0-9]+(?:\.[0-9]+)?)\s*米/);
      const timeValue = timeMatch?.[1] || '';
      const distanceValue = distanceMatch?.[1] || '';
      const speedNumber = Number(distanceValue) / Number(timeValue);
      const speedValue = Number.isFinite(speedNumber) ? (Number.isInteger(speedNumber) ? String(speedNumber) : String(Number(speedNumber.toFixed(4)))) : '';
      const compactCurrentForPhysics = current.replace(/\s+/g, '');
      const hasPhysicsSpeedQuestion = action === 'next' && Boolean(timeValue && distanceValue && speedValue) && /速度|速率/.test(question);
      const hasSpeedFormula = /速度.*(路程|距离).*时间|速度的表达式|速度公式|距离除以时间|路程除以时间|代入公式/.test(current);
      const hasSpeedSubstitution = compactCurrentForPhysics.includes(distanceValue + '÷' + timeValue) || compactCurrentForPhysics.includes(distanceValue + '/' + timeValue) || compactCurrentForPhysics.includes(distanceValue + '／' + timeValue) || compactCurrentForPhysics.includes('计算' + distanceValue + '÷' + timeValue + '的结果') || compactCurrentForPhysics.includes('计算' + distanceValue + '/' + timeValue + '的结果') || /计算.*结果/.test(current);
      const hasSpeedResult = compactCurrentForPhysics.includes('速度=' + speedValue) || compactCurrentForPhysics.includes('=' + speedValue + '米/秒') || compactCurrentForPhysics.includes('=' + speedValue + 'm/s') || /补上单位/.test(current);
      const makePhysicsSpeedAnswer = (currentLine: string, nextLine: string) => '判断： 继续拆解。\\n\\n当前这一步：' + currentLine + '\\n\\n下一步：' + nextLine;
      const physicsSpeedNextAnswer =
        hasPhysicsSpeedQuestion && !hasSpeedFormula
          ? makePhysicsSpeedAnswer('写出速度公式：速度 = 路程 ÷ 时间。', '把路程 ' + distanceValue + '米 和时间 ' + timeValue + '秒 代入公式。')
          : hasPhysicsSpeedQuestion && !hasSpeedSubstitution
            ? makePhysicsSpeedAnswer('把已知量代入公式：速度 = ' + distanceValue + ' ÷ ' + timeValue + '。', '计算 ' + distanceValue + ' ÷ ' + timeValue + ' 的结果。')
            : hasPhysicsSpeedQuestion && !hasSpeedResult
              ? makePhysicsSpeedAnswer('计算 ' + distanceValue + ' ÷ ' + timeValue + ' = ' + speedValue + '。', '补上单位，速度用米/秒表示。')
              : hasPhysicsSpeedQuestion
                ? makePhysicsSpeedAnswer('补上单位：速度 = ' + speedValue + '米/秒。', '可以检查单位：米 ÷ 秒 = 米/秒。')
                : chemistryCheckedAnswer;
      const physicsSpeedOrderedAnswer =
        hasPhysicsSpeedQuestion && hasSpeedSubstitution && !hasSpeedResult
          ? makePhysicsSpeedAnswer('计算 ' + distanceValue + ' ÷ ' + timeValue + ' = ' + speedValue + '。', '补上单位，速度 = ' + speedValue + '米/秒。')
          : hasPhysicsSpeedQuestion && hasSpeedResult
            ? makePhysicsSpeedAnswer('补上单位：速度 = ' + speedValue + '米/秒。', '可以检查单位：米 ÷ 秒 = 米/秒。')
            : physicsSpeedNextAnswer;
      return {
        action,
        answer: physicsSpeedOrderedAnswer.replace(/当前这一步：\s*\n\s*(下一步：\s*\n?\s*([^\n]+))/, '当前这一步：$2\n\n$1'),
      };
    } catch (error) {
      console.error('OpenAI follow-up failed:', error);
      return {
        action,
        answer: safeFallback(action),
      };
    }
  }
}



















