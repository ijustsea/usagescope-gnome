import type {ProviderId} from './types.js';

const NAMES: Record<ProviderId, Readonly<Record<string, string>>> = {
 codex: {free:'Free',go:'Go',plus:'Plus',pro:'Pro',team:'Team',business:'Business',enterprise:'Enterprise',edu:'Edu'},
 claude: {free:'Free',pro:'Pro',max:'Max',team:'Team',enterprise:'Enterprise',ultra:'Ultra'},
};

/** Subscription tier only. Unknown values, model names and arbitrary UI text stay unknown. */
export function planName(provider: ProviderId, raw: unknown): string | null {
 if(typeof raw!=='string'||raw.length>32||!/^[a-z]+$/i.test(raw))return null;
 const names=NAMES[provider];
 return names && Object.hasOwn(names,raw.toLowerCase()) ? names[raw.toLowerCase()]! : null;
}
