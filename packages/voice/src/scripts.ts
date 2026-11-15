/**
 * What Tomoni says on a call. Every word spoken comes from these templates: the LLM only fills
 * typed slots and never writes text the patient hears (ARCHITECTURE "Voice and conversation").
 * English and Hindi are complete; the other shipped locales fall back to English per line until
 * native speakers write them (PROGRESS). Bump SCRIPT_VERSION on any wording change.
 */
export const SCRIPT_VERSION = 'daily-call.v1';

export type ScriptLocale = 'en' | 'hi';
export type UpcomingKind =
  | 'run_out'
  | 'late_refill'
  | 'premium_jump'
  | 'formulary_removal'
  | 'tier_change'
  | 'negotiated_price_change'
  | 'pharmacy_closure'
  | 'shortage';

interface Script {
  disclosure: string;
  recordingOn: string;
  recordingOff: string;
  wellbeing: string;
  meds: string;
  medsThanks: string;
  medsMissed: string;
  upcoming: string;
  upcomingHelp: string;
  upcomingNoThanks: string;
  unclear: string;
  flagged: string;
  emergency: string;
  selfHarm: string;
  closing: string;
  voicemail: string;
  familyEmergency: string;
  item: Record<UpcomingKind, string>;
}

const en: Script = {
  disclosure:
    "Hello {name}. This is Tomoni, an automated assistant calling from {doctor}'s office at {practice}. {recording} I'm not a nurse or a doctor, and I can't give medical advice.",
  recordingOn: 'This call is recorded for your care team.',
  recordingOff: 'This call is not recorded.',
  wellbeing: 'How are you feeling today?',
  meds: "Have you taken today's medicines?",
  medsThanks: 'Good, thank you.',
  medsMissed: "Thank you for telling me. I'll let your care team know.",
  upcoming: 'One thing coming up: {item}. Would you like Tomoni to help with it?',
  upcomingHelp: 'Okay. Tomoni will start on it and your family will see it in the app.',
  upcomingNoThanks: 'Okay. Your family can still see it in the app.',
  unclear: "Sorry, I didn't catch that.",
  flagged:
    "Thank you for telling me. I can't give medical advice, so I have asked a nurse from {practice} to call you back today.",
  emergency:
    'This sounds like an emergency. Please hang up and call 911 now. I am alerting {practice} and your family right away.',
  selfHarm:
    "I'm really sorry you're feeling this way. Please call or text 988 now to talk to someone right away. If you are in danger, call 911. I am letting {practice} and your family know.",
  closing: 'Thank you, {name}. Tomoni will call again tomorrow. Goodbye.',
  // No name or health detail: a voicemail may be heard by anyone.
  voicemail:
    "This is Tomoni, an automated assistant from your doctor's office, with your daily check-in. We'll call again tomorrow.",
  familyEmergency:
    "Tomoni: on today's call {name} said something that may be an emergency and was told to call 911. {practice} has been alerted. Please check on {name} now.",
  item: {
    run_out: '{drug} needs a new prescription soon',
    late_refill: "{drug} hasn't been refilled",
    premium_jump: 'your plan premium goes up in January',
    formulary_removal: 'your plan will stop covering {drug}',
    tier_change: '{drug} will cost more on your plan',
    negotiated_price_change: '{drug} will cost more on your plan',
    pharmacy_closure: 'your pharmacy is closing',
    shortage: '{drug} is in short supply',
  },
};

const hi: Script = {
  disclosure:
    'नमस्ते {name}। मैं Tomoni हूँ, {practice} में {doctor} के दफ़्तर से कॉल करने वाली एक स्वचालित सहायक। {recording} मैं नर्स या डॉक्टर नहीं हूँ, और मैं कोई डॉक्टरी सलाह नहीं दे सकती।',
  recordingOn: 'यह कॉल आपकी केयर टीम के लिए रिकॉर्ड हो रही है।',
  recordingOff: 'यह कॉल रिकॉर्ड नहीं हो रही है।',
  wellbeing: 'आज आपकी तबीयत कैसी है?',
  meds: 'क्या आपने आज की दवाइयाँ ले लीं?',
  medsThanks: 'बहुत अच्छा, धन्यवाद।',
  medsMissed: 'बताने के लिए धन्यवाद। मैं आपकी केयर टीम को बता दूँगी।',
  upcoming: 'एक बात आने वाली है: {item}। क्या आप चाहेंगे कि Tomoni इसमें मदद करे?',
  upcomingHelp: 'ठीक है। Tomoni इस पर काम शुरू करेगा, और आपका परिवार इसे ऐप में देख सकेगा।',
  upcomingNoThanks: 'ठीक है। आपका परिवार इसे फिर भी ऐप में देख सकता है।',
  unclear: 'माफ़ कीजिए, मैं समझ नहीं पाई।',
  flagged:
    'बताने के लिए धन्यवाद। मैं डॉक्टरी सलाह नहीं दे सकती, इसलिए मैंने {practice} की एक नर्स से आज आपको वापस कॉल करने को कहा है।',
  emergency:
    'यह इमरजेंसी लग रही है। कृपया फ़ोन रखें और अभी 911 पर कॉल करें। मैं {practice} और आपके परिवार को तुरंत बता रही हूँ।',
  selfHarm:
    'मुझे बहुत दुख है कि आप ऐसा महसूस कर रहे हैं। किसी से अभी बात करने के लिए कृपया 988 पर कॉल या मैसेज करें। अगर आप ख़तरे में हैं, तो 911 पर कॉल करें। मैं {practice} और आपके परिवार को बता रही हूँ।',
  closing: 'धन्यवाद, {name}। Tomoni कल फिर कॉल करेगा। नमस्ते।',
  voicemail: 'मैं Tomoni हूँ, आपके डॉक्टर के दफ़्तर से एक स्वचालित सहायक, रोज़ की बातचीत के लिए। हम कल फिर कॉल करेंगे।',
  familyEmergency:
    'Tomoni: आज की कॉल पर {name} ने कुछ ऐसा कहा जो इमरजेंसी हो सकती है, और उन्हें 911 पर कॉल करने को कहा गया। {practice} को बता दिया गया है। कृपया अभी {name} का हाल पूछें।',
  item: {
    run_out: '{drug} के लिए जल्द नया पर्चा चाहिए',
    late_refill: '{drug} दोबारा नहीं भरी गई है',
    premium_jump: 'जनवरी में आपके प्लान का प्रीमियम बढ़ रहा है',
    formulary_removal: 'आपका प्लान {drug} को कवर करना बंद करेगा',
    tier_change: 'आपके प्लान पर {drug} महँगी हो जाएगी',
    negotiated_price_change: 'आपके प्लान पर {drug} महँगी हो जाएगी',
    pharmacy_closure: 'आपकी फ़ार्मेसी बंद हो रही है',
    shortage: '{drug} की कमी है',
  },
};

const SCRIPTS: Record<ScriptLocale, Script> = { en, hi };

export const scriptLocale = (locale: string): ScriptLocale => (locale === 'hi' ? 'hi' : 'en');

type Key = Exclude<keyof Script, 'item'>;
const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');

export function line(locale: string, key: Key, vars: Record<string, string> = {}): string {
  return fill(SCRIPTS[scriptLocale(locale)][key], vars);
}

export function itemLine(locale: string, kind: UpcomingKind, drug: string): string {
  return fill(SCRIPTS[scriptLocale(locale)].item[kind], { drug });
}
