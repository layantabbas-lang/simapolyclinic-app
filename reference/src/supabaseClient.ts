import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;

const isConfigured = !!supabaseUrl && !!supabaseAnonKey;

// Real client, initialized safely only if the parameters exist
const realClient = isConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;

// Mock chain to support safe code execution if Supabase is not connected yet
const createMockChain = () => {
  const chain: any = {
    select: (columns?: string) => {
      return Promise.resolve({ data: [], error: null });
    },
    insert: (payload: any) => {
      console.warn("Supabase is not configured. Simulating data persistence locally. Payload:", payload);
      
      const resultObj: any = {
        select: () => {
          const mockData = Array.isArray(payload) 
            ? payload.map((p, i) => ({ id: `mock-db-${Date.now()}-${i}`, ...p })) 
            : [{ id: `mock-db-${Date.now()}`, ...payload }];
          return Promise.resolve({
            data: mockData,
            error: null
          });
        }
      };
      
      // Make direct await possible for non-chained insertions: await supabase.from(...).insert(...)
      resultObj.then = (onfulfilled: any) => {
        return Promise.resolve({ data: null, error: null }).then(onfulfilled);
      };
      
      return resultObj;
    },
    delete: () => {
      const resultObj: any = {
        eq: (column: string, value: any) => {
          return Promise.resolve({ data: null, error: null });
        }
      };
      return resultObj;
    },
    update: () => {
      const resultObj: any = {
        eq: (column: string, value: any) => {
          return Promise.resolve({ data: null, error: null });
        }
      };
      return resultObj;
    }
  };
  return chain;
};

export const supabase = isConfigured && realClient ? realClient : {
  from: (table: string) => {
    console.warn(`Supabase URL/Key is missing. Operations on table "${table}" are running in local-only mock sandbox mode.`);
    return createMockChain();
  }
} as any;
