/**
 * What Tomoni says on a call. Every word spoken comes from these templates: the LLM only fills
 * typed slots and never writes text the patient hears (ARCHITECTURE "Voice and conversation").
 * English and Hindi are complete; the other shipped locales fall back to English per line until
 * native speakers write them (PROGRESS). Bump SCRIPT_VERSION on any wording change.
 */
export const SCRIPT_VERSION = 'daily-call.v3';

export type ScriptLocale = 'en' | 'hi';
export type Region = 'US' | 'IN';
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
  speechTask: string;
  speechThanks: string;
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
  speechTask:
    "One more thing, for the research study you joined. It is not part of your care, and it's fine to say skip. For about 20 seconds, please tell me what you did yesterday.",
  speechThanks: 'Thank you, that helps the study.',
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
  speechTask:
    'एक और बात, उस रिसर्च स्टडी के लिए जिसमें आप जुड़े हैं। यह आपके इलाज का हिस्सा नहीं है, और आप "छोड़ो" कह सकते हैं। लगभग 20 सेकंड के लिए, कृपया बताइए कि आपने कल क्या किया।',
  speechThanks: 'धन्यवाद, इससे स्टडी को मदद मिलती है।',
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

/**
 * India bridge (D-027): the family set the call up, the care team is Tomoni's own, emergencies go
 * to 112 and crises to Tele-MANAS (14416), and a "yes" asks the family to help: in India no agent
 * skill can act for the patient. Clinical sign-off: GO_LIVE_CHECKLIST.
 */
type Override = Partial<Omit<Script, 'item'>> & { item?: Partial<Script['item']> };
const IN: Record<ScriptLocale, Override> = {
  en: {
    disclosure:
      "Hello {name}. This is Tomoni, an automated assistant. Your family set up this daily call for you with {practice}. {recording} I'm not a nurse or a doctor, and I can't give medical advice.",
    flagged:
      "Thank you for telling me. I can't give medical advice, so I have asked someone from {practice} to call you back today.",
    emergency:
      'This sounds like an emergency. Please hang up and call 112 now. I am alerting {practice} and your family right away.',
    selfHarm:
      "I'm really sorry you're feeling this way. Please call Tele-MANAS on 14416 now to talk to someone right away. If you are in danger, call 112. I am letting {practice} and your family know.",
    upcoming: 'One thing coming up: {item}. Shall I ask your family to help with it?',
    upcomingHelp: "Okay. I'll let your family know today.",
    voicemail:
      "This is Tomoni, an automated assistant, with the daily check-in your family set up. We'll call again tomorrow.",
    familyEmergency:
      "Tomoni: on today's call {name} said something that may be an emergency and was told to call 112. {practice} has been alerted. Please check on {name} now.",
    item: {
      run_out: '{drug} runs out soon, and you may need to see your doctor for a new prescription',
    },
  },
  hi: {
    disclosure:
      'नमस्ते {name}। मैं Tomoni हूँ, एक स्वचालित सहायक। आपके परिवार ने {practice} के साथ आपके लिए यह रोज़ की कॉल शुरू की है। {recording} मैं नर्स या डॉक्टर नहीं हूँ, और मैं कोई डॉक्टरी सलाह नहीं दे सकती।',
    flagged:
      'बताने के लिए धन्यवाद। मैं डॉक्टरी सलाह नहीं दे सकती, इसलिए मैंने {practice} से किसी को आज आपको वापस कॉल करने को कहा है।',
    emergency:
      'यह इमरजेंसी लग रही है। कृपया फ़ोन रखें और अभी 112 पर कॉल करें। मैं {practice} और आपके परिवार को तुरंत बता रही हूँ।',
    selfHarm:
      'मुझे बहुत दुख है कि आप ऐसा महसूस कर रहे हैं। किसी से अभी बात करने के लिए कृपया टेली-मानस को 14416 पर कॉल करें। अगर आप ख़तरे में हैं, तो 112 पर कॉल करें। मैं {practice} और आपके परिवार को बता रही हूँ।',
    upcoming: 'एक बात आने वाली है: {item}। क्या मैं आपके परिवार से इसमें मदद करने को कहूँ?',
    upcomingHelp: 'ठीक है। मैं आज ही आपके परिवार को बता दूँगी।',
    voicemail:
      'मैं Tomoni हूँ, एक स्वचालित सहायक, उस रोज़ की बातचीत के लिए जो आपके परिवार ने शुरू की है। हम कल फिर कॉल करेंगे।',
    familyEmergency:
      'Tomoni: आज की कॉल पर {name} ने कुछ ऐसा कहा जो इमरजेंसी हो सकती है, और उन्हें 112 पर कॉल करने को कहा गया। {practice} को बता दिया गया है। कृपया अभी {name} का हाल पूछें।',
    item: {
      run_out: '{drug} जल्द ख़त्म होने वाली है, और नए पर्चे के लिए शायद आपको डॉक्टर से मिलना होगा',
    },
  },
};

const SCRIPTS: Record<ScriptLocale, Script> = { en, hi };

export const scriptLocale = (locale: string): ScriptLocale => (locale === 'hi' ? 'hi' : 'en');

type Key = Exclude<keyof Script, 'item'>;
const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');

export function line(locale: string, key: Key, vars: Record<string, string> = {}, region: Region = 'US') {
  const l = scriptLocale(locale);
  return fill((region === 'IN' ? IN[l][key] : undefined) ?? SCRIPTS[l][key], vars);
}

export function itemLine(locale: string, kind: UpcomingKind, drug: string, region: Region = 'US') {
  const l = scriptLocale(locale);
  return fill((region === 'IN' ? IN[l].item?.[kind] : undefined) ?? SCRIPTS[l].item[kind], { drug });
}
