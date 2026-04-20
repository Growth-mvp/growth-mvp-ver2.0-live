export const debugLog = (...args: unknown[]) => {
  if (process.env.NODE_ENV !== "development") return
  console.log(...args)
}

export const debugWarn = (...args: unknown[]) => {
  if (process.env.NODE_ENV !== "development") return
  console.warn(...args)
}

export const debugError = (...args: unknown[]) => {
  console.error(...args)
}
