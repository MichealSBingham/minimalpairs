export type AuditionClip = {
  id: string; wordId: string; bankId: string; languageId: string; text: string; reading?: string; ipa: string; meaning: string;
  provider: string; model: string; voiceId: string; locale: string; requestedLanguage?: string; url: string; sha256: string;
  technicalStatus: string; reviewStatus: string;
  aiAudit?: { status: string; transcript?: string; note: string };
};
export type VoiceAudition = {
  id: string; createdAt: string; textBankId: string; purpose: string; clips: AuditionClip[];
  providerNotes: string[];
};
