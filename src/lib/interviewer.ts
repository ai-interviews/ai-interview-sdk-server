import { ConversationChain } from "langchain/chains";
import { Questions } from "../constants/questions";
import { callOpenAi, initializeOpenAi } from "./openai";
import { Prompts } from "../constants/prompts";

/**
 *
 * @param array Array of strings to be shuffled
 * @returns New array with same strings in a different order
 */
const shuffle = (array: string[]) => {
  let currentIndex = array.length;

  // While there remain elements to shuffle.
  while (currentIndex != 0) {
    // Pick a remaining element.
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }

  return array;
};

export const interviewerVoices = [
  "en-CA-ClaraNeural",
  "en-CA-LiamNeural",
] as const;

export type InterviewerVoice = (typeof interviewerVoices)[number];

export type InterviewerOptions = {
  name?: string;
  age?: number;
  bio?: string;
  voice?: InterviewerVoice;
};

export class Interviewer {
  // Used to call OpenAI
  private chain: ConversationChain;

  // Number of required questions to pull from question bank
  private numRequiredQuestions: number;

  // Question bank of possible questions for interviewerOptions to ask
  private questionBank: string[];

  // Index of question to ask next
  private currentQuestionIndex: number;

  // List of questions (in-order) that interviewerOptions will ask
  private questions: string[];

  // LLM will refer to candidate by name if provided
  private candidateName?: string;

  // LLM will refer to candidate resume for questions if provided
  private candidateResume?: string;

  // LLM will refer to job title being applied for
  private jobTitle?: string;

  // LLM will refer to target job description for questions if provided
  private jobDescription?: string;

  // LLM will be prompted take on this background if provided
  private interviewerOptions?: InterviewerOptions;

  // Callback will be triggered after all questions have been asked
  private onInterviewEnd?: (feedback: string) => void;

  /**
   *
   * @param numRequiredQuestions Number of required questions to pull from question bank
   * @param questions If provided, will override default question bank
   * @param candidateName Interviewer will refer to candidate by name if provided
   */
  public constructor({
    numRequiredQuestions,
    questions,
    candidateName,
    candidateResume,
    jobTitle,
    jobDescription,
    interviewerOptions: {
      name = "Sasha",
      age = 30,
      voice = "en-CA-LiamNeural",
      bio = Prompts.DEFAULT_BIO,
    },
    onInterviewEnd,
  }: {
    numRequiredQuestions: number;
    questions?: string[];
    candidateName?: string;
    candidateResume?: string;
    jobTitle?: string;
    jobDescription?: string;
    interviewerOptions?: InterviewerOptions;
    onInterviewEnd?: (feedback: string) => void;
  }) {
    this.numRequiredQuestions = numRequiredQuestions;
    this.questionBank = shuffle(questions || Questions.STAR_METHOD);
    this.candidateName = candidateName;
    this.candidateResume = candidateResume;
    this.jobTitle = jobTitle;
    this.jobDescription = jobDescription;
    this.currentQuestionIndex = 0;
    this.interviewerOptions = {
      name,
      age,
      voice,
      bio,
    };
    this.onInterviewEnd = onInterviewEnd;
    this.chain = initializeOpenAi({
      interviewerOptions: this.interviewerOptions,
    });
  }

  /**
   * Must be called before interview begins. Prepares a list of questions, including:
   * - Introductory questions
   * - A required number from the question bank
   * - AI generated follow up questions
   */
  public async init() {
    // Generate resume question (if provided)
    let resumeQuestion;

    if (this.candidateResume) {
      resumeQuestion = await callOpenAi(
        this.chain,
        Prompts.GENERATE_RESUME_QUESTION(this.candidateResume)
      );
    }

    // Generate job question (if provided)
    let jobQuestion;

    if (this.jobTitle && this.jobDescription) {
      jobQuestion = await callOpenAi(
        this.chain,
        Prompts.GENERATE_JOB_QUESTION(this.jobTitle, this.jobDescription)
      );
    }

    // Generate introduction
    const introduction =
      "Great. " +
      (await callOpenAi(
        this.chain,
        Prompts.GENERATE_INTRODUCTION({ candidateName: this.candidateName })
      ));

    // Generate list of questions for interviewer to pose
    this.questions = [
      Questions.getOpener(this.candidateName),
      shuffle(Questions.INTERVIEW_LAYOUT)[0],
      introduction,
      Questions.FOLLOW_UP,
    ];

    if (jobQuestion) {
      this.questions.push(jobQuestion);
    }

    if (resumeQuestion) {
      this.questions.push(resumeQuestion);
    }

    // Add the number of required question-bank questions at random
    for (let i = 0; i < this.numRequiredQuestions; i++) {
      this.questions.push(this.questionBank[i], Questions.FOLLOW_UP);
    }

    // this.questions.push()
  }

  /**
   *
   * @param candidateResponse Previous response from candidate
   * @returns AI generated comment on the candidate's response, followed by either:
   * - An AI generated follow up question
   * - A question from the question bank
   */
  private async generateResponse(candidateResponse: string): Promise<string> {
    if (this.currentQuestionIndex <= 2) {
      // Hardocoded responses, regardless of what candidate said
      return this.questions[this.currentQuestionIndex];
    }

    if (this.currentQuestionIndex === this.questions.length) {
      const openAiResponse = await callOpenAi(
        this.chain,
        Prompts.END_OF_INTERVIEW
      );
      this.onInterviewEnd?.(openAiResponse);
      return "That's all of my questions. Thanks for participating in this practice interview.";
    }

    const isNextQuestionGeneratedByOpenAi =
      this.questions[this.currentQuestionIndex] === Questions.FOLLOW_UP;

    const prompt = isNextQuestionGeneratedByOpenAi
      ? Prompts.GENERATE_FOLLOW_UP_QUESTION
      : Prompts.GENERATE_FOLLOW_UP_COMMENT;

    const openAiResponse = await callOpenAi(
      this.chain,
      `
        Interviewer: "${this.questions[this.currentQuestionIndex - 1]}"
        Candidate: "${candidateResponse}"
        ${prompt}
      `
    );

    let fullResponse = "";

    if (isNextQuestionGeneratedByOpenAi) {
      fullResponse = openAiResponse;
    } else {
      fullResponse =
        openAiResponse + " " + this.questions[this.currentQuestionIndex];
    }

    return fullResponse;
  }

  /**
   *
   * @param candidateResponse Candidate's response to the previous question
   * @returns The next question for the interviewerOptions to ask
   */
  public async getNextQuestion(candidateResponse: string) {
    const response = await this.generateResponse(candidateResponse);

    this.questions[this.currentQuestionIndex++] = response;

    return response;
  }

  /**
   *
   * @returns Set interviewer options for this interview
   */
  public getInterviewerOptions() {
    return this.interviewerOptions;
  }

  /**
   *
   * @returns Get the current interview question being asked
   */
  public getCurrentQuestion() {
    const phrases =
      this.questions[Math.max(this.currentQuestionIndex - 1, 0)].split(".");
    return phrases[phrases.length - 1] || phrases[phrases.length - 2] + ".";
  }
}
