export default (hz: number, tick: (inp: { tick: number, ms: number, sc: number }) => any) => {
  
  // Call a function at a consistent frequency - accounts for the time the function takes to
  // resolve - watch out for calling heavy functions too often!
  
  const mspf = 1000 / hz;
  const startUtcMs = Date.now();
  const compensationMs = 1;
  
  let count = 0;
  let active = true;
  
  const err = Error('');
  (async () => {
    
    await null; // Wait a microtick before starting...
    
    while (active) {
      
      const ms = mspf * count;
      await tick({ tick: count, ms, sc: ms * 0.001 });
      
      count++;
      const nextMs = startUtcMs + ms + mspf;
      const delayMs = (nextMs - Date.now()) - compensationMs;
      
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      
    }
    
  })()
    .catch(cause => err[cl.fire]({ cause }));
  
  return {
    startUtcMs,
    cancel: () => active = false
  };
  
};