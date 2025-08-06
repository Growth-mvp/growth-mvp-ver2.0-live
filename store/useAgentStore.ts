import { create } from 'zustand';

type Message = { role: 'user' | 'assistant'; content: string };

type AgentState = {
  step: number;
  chatLog: Message[];
  incrementStep: () => void;
  addMessage: (msg: Message) => void;
  resetConversation: () => void;
};

export const useAgentStore = create<AgentState>((set) => ({
  step: 0,
  chatLog: [],
  incrementStep: () => set((s) => ({ step: s.step + 1 })),
  addMessage: (msg) =>
    set((s) => ({ chatLog: [...s.chatLog, msg] })),
  resetConversation: () =>
    set({ step: 0, chatLog: [] }),
}));
