export type HomeworkApiPayload = any; 
 
const API_BASE = 'http://localhost:3100'; 
 
async function postJson(path: string, payload: HomeworkApiPayload) { 
  return fetch(API_BASE + path, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(payload), 
  }); 
} 
 
export function solveHomework(payload: HomeworkApiPayload) { 
  return postJson('/api/solve', payload); 
} 
 
export function followUpHomework(payload: HomeworkApiPayload) { 
  return postJson('/api/follow-up', payload); 
} 

