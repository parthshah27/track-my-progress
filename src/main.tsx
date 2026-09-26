import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Home,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supabase } from "./supabaseClient";

import {
  deleteDailyEntry,
  getDailyEntries,
  saveDailyEntry,
  type DailyEntry,
} from "./services/dailyEntries";

import {
  createGoal,
  deleteGoal,
  getGoals,
  updateGoal,
  type Goal,
  type GoalCategory,
} from "./services/goals";
import {
  deleteWeeklyReview,
  getWeeklyReviews,
  saveWeeklyReview,
  type WeeklyReview,
} from "./services/weeklyReviews";
import {
  DEFAULT_ENABLED_AREAS,
  TRACKING_AREAS,
  TRACKING_AREAS_STORAGE_KEY,
  formatStudyMinutes,
  readEnabledAreas,
  type TrackingArea,
} from "./tracking";

import "./styles.css";

type Tab = "dashboard" | "checkin" | "history" | "analytics" | "review" | "goals" | "settings";
type AnalyticsRange = "7d" | "30d" | "all";

export function getAuthRedirectUrl({
  env = import.meta.env,
  origin = typeof window !== "undefined" ? window.location.origin : "",
} = {}) {
  const configuredUrl =
    env.VITE_SUPABASE_REDIRECT_URL ??
    env.VITE_APP_URL ??
    env.VITE_REDIRECT_URL ??
    "";

  return configuredUrl || origin || "http://localhost:3000";
}

export function stripSupabaseAuthHash(url = typeof window !== "undefined" ? window.location.href : "") {
  if (!url || !url.includes("#")) return url;

  const hash = url.split("#")[1] ?? "";
  const hasAuthToken = /(?:^|&)(access_token|refresh_token|token_type|expires_in|expires_at|provider_token)=/.test(hash);

  if (!hasAuthToken) return url;

  const pathAndQuery = url.split("#")[0] || "/";
  return pathAndQuery;
}

type WeeklyInsight = {
  type: "warning" | "positive" | "focus";
  title: string;
  message: string;
};

const emptyEntry = (date: string): DailyEntry => ({
  date,
  pnl: null,
  trades: null,
  followedRules: "",
  forcedTrade: "",
  studyTopic: "",
  studyMinutes: null,
  achievement: "",
  mistake: "",
  tomorrowPriority: "",
});

function getToday() {
  return getTodayDate();
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getTodayDate(): string {
  return formatLocalDate(new Date());
}

function getCurrentWeekStart(): string {
  const today = new Date();
  const daysSinceMonday = today.getDay() === 0 ? 6 : today.getDay() - 1;
  const monday = new Date(today);

  monday.setDate(today.getDate() - daysSinceMonday);
  monday.setHours(0, 0, 0, 0);

  return formatLocalDate(monday);
}

function getWeekEnd(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00`);
  date.setDate(date.getDate() + 6);

  return formatLocalDate(date);
}

function getMonthStart(): string {
  const today = new Date();

  const firstDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    1
  );

  return formatLocalDate(firstDay);
}

function getMonthEnd(): string {
  const today = new Date();

  const lastDay = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0
  );

  return formatLocalDate(lastDay);
}

function getProgressPercentage(
  current: number,
  target: number
): number {
  if (target <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(
      0,
      (current / target) * 100
    )
  );
}

function formatReviewWeek(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(`${getWeekEnd(weekStart)}T00:00:00`);

  const startText = start.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
  const endText = end.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return `${startText} – ${endText}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

type MonthlyGoalTargets = {
  tradingPnl: number;
  studyHours: number;
  checkinDays: number;
};

const DEFAULT_MONTHLY_GOALS: MonthlyGoalTargets = {
  tradingPnl: 20000,
  studyHours: 20,
  checkinDays: 25,
};

const MONTHLY_GOALS_STORAGE_KEY = "personal-goal-manager-monthly-goals";

function App() {
  // -------------------------
  // AUTH STATE
  // -------------------------

  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [lastAuthEmail, setLastAuthEmail] = useState<string | null>(null);

  // -------------------------
  // DATA STATE
  // -------------------------

  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const [selectedDate, setSelectedDate] = useState(getToday());

  const [form, setForm] = useState<DailyEntry>(
    emptyEntry(getToday())
  );

  const [tab, setTab] = useState<Tab>("dashboard");
  const [analyticsRange, setAnalyticsRange] =
    useState<AnalyticsRange>("7d");

  const [saveMessage, setSaveMessage] = useState("");

  const [monthlyGoalTargets, setMonthlyGoalTargets] =
    useState<MonthlyGoalTargets>(() => {
      if (typeof window === "undefined") {
        return DEFAULT_MONTHLY_GOALS;
      }

      try {
        const stored = window.localStorage.getItem(MONTHLY_GOALS_STORAGE_KEY);

        if (!stored) {
          return DEFAULT_MONTHLY_GOALS;
        }

        const parsed = JSON.parse(stored) as Partial<MonthlyGoalTargets>;

        return {
          ...DEFAULT_MONTHLY_GOALS,
          ...parsed,
        };
      } catch {
        return DEFAULT_MONTHLY_GOALS;
      }
    });
  const [monthlyGoalMessage, setMonthlyGoalMessage] = useState("");
  const [enabledAreas, setEnabledAreas] = useState<TrackingArea[]>(readEnabledAreas);

  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalMessage, setGoalMessage] = useState("");
  const [goalForm, setGoalForm] = useState({
    title: "",
    category: "upskilling" as GoalCategory,
    target: "",
    deadline: "",
  });
  const [editingGoalId, setEditingGoalId] =
    useState<string | null>(null);

  const [weeklyReviews, setWeeklyReviews] = useState<WeeklyReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const [reviewForm, setReviewForm] = useState({
    wentWell: "",
    biggestMistake: "",
    upskillingAchievement: "",
    nextWeekFocus: "",
    selfRating: "",
  });
  const [selectedReviewWeek, setSelectedReviewWeek] =
    useState<string | null>(null);

  const currentWeekStart = getCurrentWeekStart();
  const activeReviewWeek = selectedReviewWeek ?? currentWeekStart;
  const showTrading = enabledAreas.includes("trading");
  const showLearning = enabledAreas.includes("learning");

  const reflectionPrompts = useMemo(() => {
    if (showTrading && !showLearning) {
      return {
        achievement: "Today's trading win",
        mistake: "What went wrong in execution?",
        priority: "Tomorrow's one trading priority",
      };
    }

    if (showLearning && !showTrading) {
      return {
        achievement: "Today's learning win",
        mistake: "What was difficult or unclear?",
        priority: "Tomorrow's one learning priority",
      };
    }

    return {
      achievement: "Today's achievement",
      mistake: "What went wrong?",
      priority: "Tomorrow's one priority",
    };
  }, [showTrading, showLearning]);

  useEffect(() => {
    window.localStorage.setItem(
      MONTHLY_GOALS_STORAGE_KEY,
      JSON.stringify(monthlyGoalTargets)
    );
  }, [monthlyGoalTargets]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        TRACKING_AREAS_STORAGE_KEY,
        JSON.stringify(enabledAreas)
      );
    }
  }, [enabledAreas]);

  function toggleTrackingArea(area: TrackingArea) {
    setEnabledAreas((previous) => {
      const isEnabled = previous.includes(area);

      if (isEnabled) {
        const next = previous.filter((item) => item !== area);
        return next.length > 0 ? next : DEFAULT_ENABLED_AREAS;
      }

      return [...previous, area];
    });
  }

  function updateMonthlyGoalTarget(
    key: keyof MonthlyGoalTargets,
    rawValue: string
  ) {
    const numericValue = Number(rawValue);

    if (Number.isNaN(numericValue)) {
      return;
    }

    setMonthlyGoalTargets((previous) => ({
      ...previous,
      [key]:
        key === "tradingPnl"
          ? Math.max(0, Math.round(numericValue))
          : Math.max(1, Math.round(numericValue)),
    }));

    setMonthlyGoalMessage("Monthly targets saved.");
  }

  function resetMonthlyGoals() {
    setMonthlyGoalTargets(DEFAULT_MONTHLY_GOALS);
    setMonthlyGoalMessage("Monthly targets reset to defaults.");
  }

  // -------------------------
  // LOAD DAILY ENTRIES
  // -------------------------

  async function loadDailyEntries() {
    try {
      setDataLoading(true);

      const data = await getDailyEntries();

      setEntries(data);
    } catch (error) {
      console.error("Failed to load entries:", error);

      if (error instanceof Error) {
        setSaveMessage(
          `Could not load entries: ${error.message}`
        );
      }
    } finally {
      setDataLoading(false);
    }
  }

  async function loadGoals() {
    try {
      setGoalsLoading(true);
      setGoals(await getGoals());
    } catch (error) {
      console.error("Failed to load goals:", error);
      setGoalMessage(
        error instanceof Error
          ? `Failed to load goals: ${error.message}`
          : "Failed to load goals."
      );
    } finally {
      setGoalsLoading(false);
    }
  }

  async function loadWeeklyReviews() {
    try {
      setReviewsLoading(true);
      setWeeklyReviews(await getWeeklyReviews());
    } catch (error) {
      console.error("Failed to load weekly reviews:", error);
      setReviewMessage(
        error instanceof Error
          ? error.message
          : "Failed to load weekly reviews."
      );
    } finally {
      setReviewsLoading(false);
    }
  }

  async function handleSaveWeeklyReview() {
    try {
      setReviewSaving(true);
      setReviewMessage("");

      const savedReview = await saveWeeklyReview({
        weekStart: activeReviewWeek,
        wentWell: reviewForm.wentWell,
        biggestMistake: reviewForm.biggestMistake,
        upskillingAchievement: reviewForm.upskillingAchievement,
        nextWeekFocus: reviewForm.nextWeekFocus,
        selfRating: reviewForm.selfRating
          ? Number(reviewForm.selfRating)
          : null,
      });

      setWeeklyReviews((previous) => {
        const exists = previous.some((review) => review.id === savedReview.id);

        return exists
          ? previous.map((review) => review.id === savedReview.id ? savedReview : review)
          : [savedReview, ...previous];
      });

      setReviewMessage("Weekly review saved.");
    } catch (error) {
      console.error("Failed to save weekly review:", error);
      setReviewMessage(
        error instanceof Error
          ? error.message
          : "Failed to save weekly review."
      );
    } finally {
      setReviewSaving(false);
    }
  }

  async function handleDeleteWeeklyReview(review: WeeklyReview) {
    const confirmed = window.confirm(
      `Delete the review for ${formatReviewWeek(review.weekStart)}?`
    );

    if (!confirmed) {
      return;
    }

    try {
      await deleteWeeklyReview(review.id);
      setWeeklyReviews((previous) =>
        previous.filter((item) => item.id !== review.id)
      );

      if (activeReviewWeek === review.weekStart) {
        setSelectedReviewWeek(null);
      }

      setReviewMessage("Weekly review deleted.");
    } catch (error) {
      console.error("Failed to delete weekly review:", error);
      setReviewMessage(
        error instanceof Error
          ? error.message
          : "Failed to delete weekly review."
      );
    }
  }

  function resetGoalForm() {
    setGoalForm({ title: "", category: "upskilling", target: "", deadline: "" });
    setEditingGoalId(null);
  }

  async function saveGoal() {
    if (!goalForm.title.trim()) {
      setGoalMessage("Goal title is required.");
      return;
    }

    if (!editingGoalId && goals.filter((goal) => goal.status === "active").length >= 3) {
      setGoalMessage("You already have 3 active goals. Complete, archive, or delete one before adding another.");
      return;
    }

    try {
      setGoalSaving(true);
      setGoalMessage("");
      if (editingGoalId) {
        const updatedGoal = await updateGoal(editingGoalId, {
          title: goalForm.title,
          category: goalForm.category,
          target: goalForm.target,
          deadline: goalForm.deadline || null,
        });
        setGoals((previous) => previous.map((goal) => goal.id === updatedGoal.id ? updatedGoal : goal));
        setGoalMessage("Goal updated successfully.");
      } else {
        const newGoal = await createGoal({
          title: goalForm.title,
          category: goalForm.category,
          target: goalForm.target,
          deadline: goalForm.deadline || null,
        });
        setGoals((previous) => [newGoal, ...previous]);
        setGoalMessage("Goal created successfully.");
      }
      resetGoalForm();
    } catch (error) {
      console.error("Failed to save goal:", error);
      setGoalMessage(error instanceof Error ? error.message : "Failed to save goal.");
    } finally {
      setGoalSaving(false);
    }
  }

  function editGoal(goal: Goal) {
    setEditingGoalId(goal.id);
    setGoalForm({
      title: goal.title,
      category: goal.category,
      target: goal.target,
      deadline: goal.deadline ?? "",
    });
    setGoalMessage("");
  }

  async function toggleGoalStatus(goal: Goal) {
    const status = goal.status === "active" ? "completed" : "active";
    if (status === "active" && goals.filter((item) => item.status === "active").length >= 3) {
      setGoalMessage("You already have 3 active goals.");
      return;
    }
    try {
      const updatedGoal = await updateGoal(goal.id, { status });
      setGoals((previous) => previous.map((item) => item.id === updatedGoal.id ? updatedGoal : item));
      setGoalMessage(status === "completed" ? "Goal completed." : "Goal moved back to active.");
    } catch (error) {
      console.error("Failed to update goal:", error);
      setGoalMessage(error instanceof Error ? error.message : "Failed to update goal.");
    }
  }

  async function removeGoal(id: string) {
    if (!window.confirm("Delete this goal?")) return;
    try {
      await deleteGoal(id);
      setGoals((previous) => previous.filter((goal) => goal.id !== id));
      if (editingGoalId === id) resetGoalForm();
      setGoalMessage("Goal deleted.");
    } catch (error) {
      console.error("Failed to delete goal:", error);
      setGoalMessage(error instanceof Error ? error.message : "Failed to delete goal.");
    }
  }

  // -------------------------
  // AUTH INITIALIZATION
  // -------------------------

  useEffect(() => {
    async function initializeAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const currentUser = session?.user ?? null;

      if (typeof window !== "undefined") {
        const cleanUrl = stripSupabaseAuthHash();
        if (cleanUrl !== window.location.href) {
          window.history.replaceState({}, document.title, cleanUrl);
        }
      }

      setUser(currentUser);
      setAuthLoading(false);

      if (currentUser) {
        await Promise.all([loadDailyEntries(), loadGoals(), loadWeeklyReviews()]);
      } else {
        setDataLoading(false);
      }
    }

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const currentUser = session?.user ?? null;

        setUser(currentUser);

        if (currentUser) {
          await Promise.all([loadDailyEntries(), loadGoals(), loadWeeklyReviews()]);
        } else {
          setEntries([]);
          setGoals([]);
          setWeeklyReviews([]);
          setDataLoading(false);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // -------------------------
  // UPDATE FORM WHEN DATE CHANGES
  // -------------------------

  useEffect(() => {
    const existingEntry = entries.find(
      (entry) => entry.date === selectedDate
    );

    setForm(
      existingEntry || emptyEntry(selectedDate)
    );
  }, [selectedDate, entries]);

  // -------------------------
  // DASHBOARD METRICS
  // -------------------------

  const metrics = useMemo(() => {
    const totalPnl = entries.reduce(
      (sum, entry) => sum + (entry.pnl ?? 0),
      0
    );

    const totalStudy = entries.reduce(
      (sum, entry) =>
        sum + (entry.studyMinutes ?? 0),
      0
    );

    const ruleDays = entries.filter(
      (entry) =>
        entry.followedRules === "yes"
    ).length;

    const profitableDays = entries.filter(
      (entry) => (entry.pnl ?? 0) > 0
    ).length;

    const dates = new Set(
      entries.map((entry) => entry.date)
    );

    let streak = 0;

    const cursor = new Date();

    while (
      dates.has(
        cursor.toISOString().slice(0, 10)
      )
    ) {
      streak++;

      cursor.setDate(
        cursor.getDate() - 1
      );
    }

    return {
      totalPnl,
      totalStudy,
      ruleDays,
      profitableDays,
      streak,
    };
  }, [entries]);

  const monthlyProgress = useMemo(() => {
    const monthStart = getMonthStart();
    const monthEnd = getMonthEnd();

    const monthEntries = entries.filter(
      (entry) =>
        entry.date >= monthStart &&
        entry.date <= monthEnd
    );

    const totalPnl = monthEntries.reduce(
      (sum, entry) => sum + (entry.pnl ?? 0),
      0
    );

    const totalStudyMinutes = monthEntries.reduce(
      (sum, entry) =>
        sum + (entry.studyMinutes ?? 0),
      0
    );

    return {
      totalPnl,
      totalStudyMinutes,
      totalStudyHours: totalStudyMinutes / 60,
      checkinDays: monthEntries.length,
    };
  }, [entries]);

  const goalsProgress = useMemo(() => {
    const tradingTarget = monthlyGoalTargets.tradingPnl;
    const studyTargetMinutes = monthlyGoalTargets.studyHours * 60;
    const consistencyTarget = monthlyGoalTargets.checkinDays;

    return {
      trading: {
        current: monthlyProgress.totalPnl,
        target: tradingTarget,
        percentage: getProgressPercentage(
          Math.max(0, monthlyProgress.totalPnl),
          tradingTarget
        ),
      },
      upskilling: {
        current: monthlyProgress.totalStudyMinutes,
        target: studyTargetMinutes,
        percentage: getProgressPercentage(
          monthlyProgress.totalStudyMinutes,
          studyTargetMinutes
        ),
      },
      consistency: {
        current: monthlyProgress.checkinDays,
        target: consistencyTarget,
        percentage: getProgressPercentage(
          monthlyProgress.checkinDays,
          consistencyTarget
        ),
      },
    };
  }, [monthlyProgress]);

  const analytics = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sortedEntries = [...entries].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    const getEntryDate = (date: string) =>
      new Date(`${date}T00:00:00`);

    const filteredEntries = sortedEntries.filter((entry) => {
      if (analyticsRange === "all") {
        return true;
      }

      const entryDate = getEntryDate(entry.date);
      entryDate.setHours(0, 0, 0, 0);

      const days = analyticsRange === "7d" ? 7 : 30;
      const startDate = new Date(today);
      startDate.setDate(today.getDate() - (days - 1));

      return entryDate >= startDate && entryDate <= today;
    });

    const tradingEntries = filteredEntries.filter(
      (entry) => entry.pnl !== null
    );
    const totalPnl = tradingEntries.reduce(
      (sum, entry) => sum + (entry.pnl ?? 0),
      0
    );
    const averagePnl = tradingEntries.length > 0
      ? totalPnl / tradingEntries.length
      : 0;
    const profitableDays = tradingEntries.filter(
      (entry) => (entry.pnl ?? 0) > 0
    ).length;
    const losingDays = tradingEntries.filter(
      (entry) => (entry.pnl ?? 0) < 0
    ).length;
    const breakevenDays = tradingEntries.filter(
      (entry) => entry.pnl === 0
    ).length;
    const winRate = profitableDays + losingDays > 0
      ? (profitableDays / (profitableDays + losingDays)) * 100
      : 0;

    const ruleEntries = filteredEntries.filter(
      (entry) => entry.followedRules === "yes" || entry.followedRules === "no"
    );
    const rulesFollowed = ruleEntries.filter(
      (entry) => entry.followedRules === "yes"
    ).length;
    const ruleFollowRate = ruleEntries.length > 0
      ? (rulesFollowed / ruleEntries.length) * 100
      : 0;
    const forcedTradeCount = filteredEntries.filter(
      (entry) => entry.forcedTrade === "yes"
    ).length;
    const totalStudyMinutes = filteredEntries.reduce(
      (sum, entry) => sum + (entry.studyMinutes ?? 0),
      0
    );
    const studyDays = filteredEntries.filter(
      (entry) => (entry.studyMinutes ?? 0) > 0
    ).length;
    const averageStudyMinutes = studyDays > 0
      ? totalStudyMinutes / studyDays
      : 0;

    const pnlChartData = filteredEntries.map((entry) => ({
      date: getEntryDate(entry.date).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      }),
      pnl: entry.pnl ?? 0,
    }));
    const studyChartData = filteredEntries.map((entry) => ({
      date: getEntryDate(entry.date).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      }),
      minutes: entry.studyMinutes ?? 0,
    }));

    return {
      entries: filteredEntries,
      totalPnl,
      averagePnl,
      profitableDays,
      losingDays,
      breakevenDays,
      winRate,
      ruleFollowRate,
      forcedTradeCount,
      totalStudyMinutes,
      studyDays,
      averageStudyMinutes,
      loggedDays: filteredEntries.length,
      pnlChartData,
      studyChartData,
    };
  }, [entries, analyticsRange]);

  const weeklySummary = useMemo(() => {
    const weekStartDate = new Date(`${activeReviewWeek}T00:00:00`);
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekStartDate.getDate() + 6);

    const weekEntries = entries.filter((entry) => {
      const entryDate = new Date(`${entry.date}T00:00:00`);

      return entryDate >= weekStartDate && entryDate <= weekEndDate;
    });
    const tradingEntries = weekEntries.filter((entry) => entry.pnl !== null);
    const totalPnl = tradingEntries.reduce(
      (sum, entry) => sum + (entry.pnl ?? 0),
      0
    );
    const profitableDays = tradingEntries.filter(
      (entry) => (entry.pnl ?? 0) > 0
    ).length;
    const losingDays = tradingEntries.filter(
      (entry) => (entry.pnl ?? 0) < 0
    ).length;
    const breakevenDays = tradingEntries.filter(
      (entry) => entry.pnl === 0
    ).length;
    const winRate = profitableDays + losingDays > 0
      ? (profitableDays / (profitableDays + losingDays)) * 100
      : 0;
    const ruleEntries = weekEntries.filter(
      (entry) => entry.followedRules === "yes" || entry.followedRules === "no"
    );
    const rulesFollowed = ruleEntries.filter((entry) => entry.followedRules === "yes").length;
    const ruleFollowRate = ruleEntries.length > 0
      ? (rulesFollowed / ruleEntries.length) * 100
      : 0;
    const forcedTrades = weekEntries.filter((entry) => entry.forcedTrade === "yes").length;
    const studyMinutes = weekEntries.reduce(
      (sum, entry) => sum + (entry.studyMinutes ?? 0),
      0
    );

    return {
      totalPnl,
      profitableDays,
      losingDays,
      breakevenDays,
      winRate,
      ruleFollowRate,
      forcedTrades,
      studyMinutes,
      loggedDays: weekEntries.length,
    };
  }, [entries, activeReviewWeek]);

  const weeklyInsights = useMemo(() => {
    const insights: WeeklyInsight[] = [];

    if (weeklySummary.loggedDays < 4) {
      insights.push({
        type: "warning",
        title: "Low consistency",
        message: `You logged only ${weeklySummary.loggedDays} day${
          weeklySummary.loggedDays === 1 ? "" : "s"
        } this week. The first problem is not performance — it is missing data.`,
      });
    } else if (weeklySummary.loggedDays >= 6) {
      insights.push({
        type: "positive",
        title: "Strong consistency",
        message: `You logged ${weeklySummary.loggedDays} days this week.`,
      });
    }

    if (showTrading) {
      if (weeklySummary.ruleFollowRate > 0) {
        if (weeklySummary.ruleFollowRate < 70) {
          insights.push({
            type: "warning",
            title: "Trading discipline needs attention",
            message: `Your rule-follow rate was ${weeklySummary.ruleFollowRate.toFixed(0)}%. The issue may be execution rather than strategy.`,
          });
        } else if (weeklySummary.ruleFollowRate >= 90) {
          insights.push({
            type: "positive",
            title: "Strong rule discipline",
            message: `You followed your trading rules ${weeklySummary.ruleFollowRate.toFixed(0)}% of the time.`,
          });
        }
      }

      if (weeklySummary.forcedTrades > 0) {
        insights.push({
          type: "warning",
          title: "Forced trades detected",
          message: `${weeklySummary.forcedTrades} forced trade${
            weeklySummary.forcedTrades === 1 ? "" : "s"
          } logged this week. Removing unnecessary trades may matter more than finding more setups.`,
        });
      }

      if (weeklySummary.profitableDays + weeklySummary.losingDays >= 3) {
        if (weeklySummary.losingDays > weeklySummary.profitableDays) {
          insights.push({
            type: "warning",
            title: "More losing days than profitable days",
            message: `${weeklySummary.losingDays} losing days versus ${weeklySummary.profitableDays} profitable days.`,
          });
        } else if (weeklySummary.profitableDays > weeklySummary.losingDays) {
          insights.push({
            type: "positive",
            title: "Positive trading week",
            message: `${weeklySummary.profitableDays} profitable days versus ${weeklySummary.losingDays} losing days.`,
          });
        }
      }
    }

    if (showLearning) {
      if (weeklySummary.studyMinutes === 0) {
        insights.push({
          type: "warning",
          title: "No upskilling logged",
          message: "No study time was recorded this week. Either you did not study, or you did not log it.",
        });
      } else if (weeklySummary.studyMinutes >= 300) {
        insights.push({
          type: "positive",
          title: "Meaningful upskilling effort",
          message: `You invested ${Math.floor(weeklySummary.studyMinutes / 60)}h ${
            weeklySummary.studyMinutes % 60
          }m in learning this week.`,
        });
      }
    }

    let focusMessage =
      "Maintain consistency and avoid changing multiple things at once.";

    if (weeklySummary.loggedDays < 4) {
      focusMessage =
        "Log your daily check-in consistently before trying to optimise performance.";
    } else if (showTrading && weeklySummary.forcedTrades > 0) {
      focusMessage = "Avoid forced trades. Take only planned setups next week.";
    } else if (
      showTrading &&
      weeklySummary.ruleFollowRate > 0 &&
      weeklySummary.ruleFollowRate < 70
    ) {
      focusMessage =
        "Focus on following your trading rules before trying to improve profits.";
    } else if (showLearning && weeklySummary.studyMinutes === 0) {
      focusMessage = "Schedule a minimum study block and log it every day.";
    } else if (showTrading && weeklySummary.losingDays > weeklySummary.profitableDays) {
      focusMessage =
        "Review losing trades and identify whether losses came from bad execution or valid setups.";
    }

    insights.push({
      type: "focus",
      title: "Suggested focus for next week",
      message: focusMessage,
    });

    return insights;
  }, [weeklySummary, showTrading, showLearning]);

  // The dashboard always reflects the current calendar week, even while a
  // historical week is selected in the review screen.
  const dashboardWeeklySummary = useMemo(() => {
  const weekStartDate = new Date(
    `${currentWeekStart}T00:00:00`
  );

  const weekEndDate = new Date(
    weekStartDate
  );

  weekEndDate.setDate(
    weekStartDate.getDate() + 6
  );

  const weekEntries = entries.filter(
    (entry) => {
      const entryDate = new Date(
        `${entry.date}T00:00:00`
      );

      return (
        entryDate >= weekStartDate &&
        entryDate <= weekEndDate
      );
    }
  );

  const tradingEntries =
    weekEntries.filter(
      (entry) => entry.pnl !== null
    );

  const totalPnl = tradingEntries.reduce(
    (sum, entry) =>
      sum + (entry.pnl ?? 0),
    0
  );

  const ruleEntries = weekEntries.filter(
    (entry) =>
      entry.followedRules === "yes" ||
      entry.followedRules === "no"
  );

  const rulesFollowed =
    ruleEntries.filter(
      (entry) =>
        entry.followedRules === "yes"
    ).length;

  const ruleFollowRate =
    ruleEntries.length > 0
      ? (rulesFollowed /
          ruleEntries.length) *
        100
      : 0;

  const studyMinutes =
    weekEntries.reduce(
      (sum, entry) =>
        sum +
        (entry.studyMinutes ?? 0),
      0
    );

  const forcedTrades =
    weekEntries.filter(
      (entry) =>
        entry.forcedTrade === "yes"
    ).length;

  return {
    totalPnl,
    ruleFollowRate,
    studyMinutes,
    forcedTrades,
    loggedDays: weekEntries.length,
  };
}, [entries, currentWeekStart]);

  const dashboardData = useMemo(() => {
  const today = getTodayDate();

  const todayEntry =
    entries.find(
      (entry) => entry.date === today
    ) ?? null;

  const currentWeekReview =
    weeklyReviews.find(
      (review) =>
        review.weekStart === currentWeekStart
    );

  let fallbackFocus =
    "Complete your daily check-in and stay consistent.";

  if (dashboardWeeklySummary.loggedDays < 4) {
    fallbackFocus =
      "Focus on logging your daily progress consistently.";
  } else if (
    dashboardWeeklySummary.forcedTrades > 0
  ) {
    fallbackFocus =
      "Avoid forced trades and take only planned setups.";
  } else if (
    dashboardWeeklySummary.ruleFollowRate > 0 &&
    dashboardWeeklySummary.ruleFollowRate < 70
  ) {
    fallbackFocus =
      "Prioritize following your trading rules over chasing profit.";
  } else if (
    dashboardWeeklySummary.studyMinutes === 0
  ) {
    fallbackFocus =
      "Complete at least one focused upskilling session this week.";
  }

  return {
    todayEntry,

    currentFocus:
      currentWeekReview?.nextWeekFocus ||
      fallbackFocus,
  };
}, [
  entries,
  weeklyReviews,
  currentWeekStart,
  dashboardWeeklySummary,
]);

const consistencyData = useMemo(() => {
  const loggedDates = new Set(
    entries.map((entry) => entry.date)
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Current streak:
  // If today is not logged yet, start checking from yesterday.
  let streakStart = new Date(today);

  if (!loggedDates.has(formatLocalDate(streakStart))) {
    streakStart.setDate(streakStart.getDate() - 1);
  }

  let currentStreak = 0;
  const cursor = new Date(streakStart);

  while (loggedDates.has(formatLocalDate(cursor))) {
    currentStreak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Longest streak across all logged dates
  const sortedDates = Array.from(loggedDates)
    .sort()
    .map(
      (date) =>
        new Date(`${date}T00:00:00`)
    );

  let longestStreak = 0;
  let runningStreak = 0;
  let previousDate: Date | null = null;

  sortedDates.forEach((date) => {
    if (!previousDate) {
      runningStreak = 1;
    } else {
      const difference =
        Math.round(
          (date.getTime() -
            previousDate.getTime()) /
            (1000 * 60 * 60 * 24)
        );

      if (difference === 1) {
        runningStreak += 1;
      } else {
        runningStreak = 1;
      }
    }

    longestStreak = Math.max(
      longestStreak,
      runningStreak
    );

    previousDate = date;
  });

  // Last 7 calendar days for the visual tracker
  const lastSevenDays = Array.from(
    { length: 7 },
    (_, index) => {
      const date = new Date(today);

      date.setDate(
        today.getDate() - 6 + index
      );

      const dateString =
        formatLocalDate(date);

      return {
        date: dateString,
        day: date.toLocaleDateString(
          "en-IN",
          {
            weekday: "short",
          }
        ),
        logged:
          loggedDates.has(dateString),
        isToday:
          dateString ===
          formatLocalDate(today),
      };
    }
  );

  // Yesterday missed detection
  const yesterday = new Date(today);
  yesterday.setDate(
    yesterday.getDate() - 1
  );

  const yesterdayDate =
    formatLocalDate(yesterday);

  const missedYesterday =
    !loggedDates.has(yesterdayDate);

  return {
    currentStreak,
    longestStreak,
    lastSevenDays,
    missedYesterday,
  };
}, [entries]);

  useEffect(() => {
    const currentReview = weeklyReviews.find(
      (review) => review.weekStart === activeReviewWeek
    );

    setReviewForm(currentReview ? {
      wentWell: currentReview.wentWell,
      biggestMistake: currentReview.biggestMistake,
      upskillingAchievement: currentReview.upskillingAchievement,
      nextWeekFocus: currentReview.nextWeekFocus,
      selfRating: currentReview.selfRating ? String(currentReview.selfRating) : "",
    } : {
      wentWell: "",
      biggestMistake: "",
      upskillingAchievement: "",
      nextWeekFocus: "",
      selfRating: "",
    });
  }, [weeklyReviews, activeReviewWeek]);

  const activeGoals = goals.filter(
    (goal) => goal.status === "active"
  );
  const completedGoals = goals.filter(
    (goal) => goal.status === "completed"
  );
  const visibleMetricAreas = [
    { key: "trading", enabled: showTrading, label: "Trading" },
    { key: "learning", enabled: showLearning, label: "Learning" },
  ].filter((item) => item.enabled);

  // -------------------------
  // UPDATE FORM FIELD
  // -------------------------

  function update<K extends keyof DailyEntry>(
    key: K,
    value: DailyEntry[K]
  ) {
    setForm((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  // -------------------------
  // GOOGLE LOGIN
  // -------------------------

  async function signInWithGoogle() {
    setAuthError(null);
    setAuthActionLoading(true);

    try {
      const redirectTo = getAuthRedirectUrl({
        env: import.meta.env,
        origin: window.location.origin,
      });

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });

      if (error) throw error;
    } catch (e: any) {
      setAuthError(e?.message ?? String(e));
    } finally {
      setAuthActionLoading(false);
    }
  }

  async function signInWithEmail() {
    setAuthError(null);
    setAuthActionLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });

      if (error) throw error;
    } catch (e: any) {
      setAuthError(e?.message ?? String(e));
    } finally {
      setAuthActionLoading(false);
    }
  }

  async function handleAuthSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (authMode === "signin") {
      await signInWithEmail();
      return;
    }

    await signUpWithEmail();
  }

  async function signUpWithEmail() {
    setAuthError(null);
    setAuthActionLoading(true);

    try {
      const { data: existingSessionData, error: existingSessionError } =
        await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });

      if (!existingSessionError && existingSessionData.user) {
        setAuthError(
          "An account with this email already exists. Please sign in instead."
        );
        setAuthMode("signin");
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: authEmail,
        password: authPassword,
      });

      if (error) {
        const message = error.message.toLowerCase();

        if (
          message.includes("already registered") ||
          message.includes("user already")
        ) {
          setAuthError(
            "An account with this email already exists. Please sign in instead."
          );
          setAuthMode("signin");
          return;
        }

        throw error;
      }

      setLastAuthEmail(authEmail || null);
      setAuthSuccess(
        `Registered — check ${authEmail} for a confirmation link (also check spam).`
      );
      setAuthEmail("");
      setAuthPassword("");
      setAuthMode("signin");
    } catch (e: any) {
      setAuthError(e?.message ?? String(e));
    } finally {
      setAuthActionLoading(false);
    }
  }

  async function sendMagicLink() {
    const email = lastAuthEmail ?? authEmail;

    if (!email) {
      setAuthError("Provide an email to send a sign-in link.");
      return;
    }

    setAuthError(null);
    setAuthActionLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({ email });

      if (error) throw error;

      setAuthSuccess(`Magic sign-in link sent to ${email}.`);
    } catch (e: any) {
      setAuthError(e?.message ?? String(e));
    } finally {
      setAuthActionLoading(false);
    }
  }

  // -------------------------
  // LOGOUT
  // -------------------------

  async function signOut() {
    const { error } =
      await supabase.auth.signOut();

    if (error) {
      alert(error.message);
    }
  }

  // -------------------------
  // SAVE ENTRY
  // -------------------------

  async function saveEntry() {
    try {
      setSaveMessage("Saving...");

      await saveDailyEntry(form);

      setEntries((previous) => {
        const exists = previous.some(
          (entry) =>
            entry.date === form.date
        );

        const next = exists
          ? previous.map((entry) =>
              entry.date === form.date
                ? form
                : entry
            )
          : [...previous, form];

        return next.sort((a, b) =>
          b.date.localeCompare(a.date)
        );
      });

      setSaveMessage(
        "Saved successfully."
      );

      setTimeout(() => {
        setSaveMessage("");
        setTab("dashboard");
      }, 700);
    } catch (error) {
      console.error(
        "Failed to save entry:",
        error
      );

      setSaveMessage(
        error instanceof Error
          ? `Save failed: ${error.message}`
          : "Failed to save entry."
      );
    }
  }

  // -------------------------
  // DELETE ENTRY
  // -------------------------

  async function deleteEntry(date: string) {
    if (
      !window.confirm(
        "Delete this daily entry?"
      )
    ) {
      return;
    }

    try {
      await deleteDailyEntry(date);

      setEntries((previous) =>
        previous.filter(
          (entry) =>
            entry.date !== date
        )
      );

      setSaveMessage("Entry deleted.");
    } catch (error) {
      console.error(
        "Failed to delete entry:",
        error
      );

      alert(
        error instanceof Error
          ? error.message
          : "Failed to delete entry."
      );
    }
  }

  // -------------------------
  // AUTH LOADING SCREEN
  // -------------------------

  if (authLoading) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>TrackMyProgress</h1>

          <p>
            Loading...
          </p>
        </div>
      </div>
    );
  }

  // -------------------------
  // LOGIN SCREEN
  // -------------------------

  if (!user) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            ✓
          </div>

          <h1>
            Track My Progress
          </h1>

          <p>
            Track your trading,
            upskilling, and daily
            progress. One place.
            Every day.
          </p>
          {authError && <div style={{ color: "#fca5a5", marginBottom: 10 }}>{authError}</div>}

          {authSuccess ? (
            <div className="auth-success" style={{ marginBottom: 12 }}>
              <div style={{ color: "#86efac" }}>{authSuccess}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "center" }}>
                <button className="small-button" onClick={() => setAuthSuccess(null)}>
                  Close
                </button>
                <button className="secondary-button" onClick={sendMagicLink} disabled={authActionLoading}>
                  Send sign-in link
                </button>
              </div>
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 10 }}>
            <button className="google-button oauth-button" onClick={signInWithGoogle} disabled={authActionLoading}>
              Continue with Google
            </button>

            <div style={{ textAlign: "center", color: "#94a3b8", fontSize: ".9rem" }}>or</div>

            <form className="email-form" onSubmit={handleAuthSubmit}>
              <input placeholder="Email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
              <input placeholder="Password" type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />

              <button
                type="submit"
                className="primary"
                disabled={authActionLoading}
              >
                {authMode === "signin" ? "Sign in" : "Create account"}
              </button>

              <div style={{ marginTop: 8, fontSize: ".9rem", color: "#94a3b8" }}>
                {authMode === "signin" ? (
                  <span>
                    New here? <button type="button" className="text-button" onClick={() => setAuthMode("signup")}>Create an account</button>
                  </span>
                ) : (
                  <span>
                    Already have an account? <button type="button" className="text-button" onClick={() => setAuthMode("signin")}>Sign in</button>
                  </span>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------
  // DATA LOADING SCREEN
  // -------------------------

  if (dataLoading && user) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>
            Track My Progress
          </h1>

          <p>
            Loading your tracker...
          </p>
        </div>
      </div>
    );
  }

  // -------------------------
  // MAIN APP
  // -------------------------

  return (
    <div className="app-shell">

      {/* HEADER */}

      <header className="topbar">
        <div>
          <div className="brand">
            Track My Progress
          </div>

          <div className="subtitle">
            Small actions. Real data.
          </div>
        </div>

        <div className="user-section">
          <span className="user-name">
            {user.user_metadata
              ?.full_name ||
              user.email}
          </span>

          <button
            className="logout-button"
            onClick={signOut}
          >
            Logout
          </button>
        </div>
      </header>

      {/* MAIN CONTENT */}

      <main>

        {/* DASHBOARD */}

        {tab === "dashboard" && (
  <section className="page dashboard-page">
    <div className="dashboard-header">
      <div>
        <p className="muted">
          {new Date().toLocaleDateString(
            "en-IN",
            {
              weekday: "long",
              day: "numeric",
              month: "long",
            }
          )}
        </p>

        <h1>Today</h1>
      </div>

      <span
        className={`checkin-status ${
          dashboardData.todayEntry
            ? "complete"
            : "pending"
        }`}
      >
        {dashboardData.todayEntry
          ? "✓ Logged"
          : "Not logged"}
      </span>
    </div>

    {consistencyData.missedYesterday && (
      <section className="missed-day-warning card">
        <div>
          <strong>You missed yesterday's check-in</strong>

          <p>
            Log it now if you remember what happened.
          </p>
        </div>

        <button
          className="secondary-button"
          onClick={() => setTab("checkin")}
        >
          Log now
        </button>
      </section>
    )}

    <section className="dashboard-section">
      <h2>Today's progress</h2>

      {dashboardData.todayEntry ? (
        <div className="dashboard-grid">
          {showTrading && (
            <>
              <AnalyticsCard
                label="Today's P&L"
                value={formatCurrency(dashboardData.todayEntry.pnl ?? 0)}
                valueClass={(dashboardData.todayEntry.pnl ?? 0) >= 0 ? "positive" : "negative"}
              />

              <AnalyticsCard
                label="Rules followed"
                value={
                  dashboardData.todayEntry.followedRules === "yes"
                    ? "Yes"
                    : dashboardData.todayEntry.followedRules === "no"
                    ? "No"
                    : "—"
                }
              />

              <AnalyticsCard
                label="Forced trade"
                value={
                  dashboardData.todayEntry.forcedTrade === "yes"
                    ? "Yes"
                    : dashboardData.todayEntry.forcedTrade === "no"
                    ? "No"
                    : "—"
                }
              />
            </>
          )}

          {showLearning && (
            <AnalyticsCard
              label="Study time"
              value={formatStudyMinutes(dashboardData.todayEntry.studyMinutes ?? 0)}
            />
          )}
        </div>
      ) : (
        <section className="card dashboard-empty">
          <h3>No check-in yet</h3>

          <p className="muted">
            Don't wait until the week ends. Log today while the details are fresh.
          </p>

          <button className="primary" onClick={() => setTab("checkin")}>
            Complete Daily Check-in
          </button>
        </section>
      )}
    </section>

    <section className="dashboard-section consistency-section">
      <div className="section-title-row">
        <div>
          <h2>Consistency</h2>
          <p className="muted">Your logging habit</p>
        </div>
      </div>

      <div className="streak-grid">
        <section className="card streak-card">
          <span className="streak-icon">🔥</span>
          <div>
            <span className="streak-label">Current streak</span>
            <strong className="streak-value">{consistencyData.currentStreak}</strong>
            <span className="streak-days">{consistencyData.currentStreak === 1 ? "day" : "days"}</span>
          </div>
        </section>

        <section className="card streak-card">
          <span className="streak-icon">🏆</span>
          <div>
            <span className="streak-label">Best streak</span>
            <strong className="streak-value">{consistencyData.longestStreak}</strong>
            <span className="streak-days">{consistencyData.longestStreak === 1 ? "day" : "days"}</span>
          </div>
        </section>
      </div>

      <section className="card week-tracker">
        <div className="week-tracker-header">
          <h3>Last 7 days</h3>
          <span className="muted">✓ Logged</span>
        </div>

        <div className="week-days">
          {consistencyData.lastSevenDays.map((day) => (
            <div key={day.date} className={`week-day ${day.logged ? "logged" : "missed"} ${day.isToday ? "today" : ""}`}>
              <span className="week-day-name">{day.day}</span>
              <span className="week-day-status">{day.logged ? "✓" : day.isToday ? "•" : "—"}</span>
            </div>
          ))}
        </div>
      </section>
    </section>

    <section className="dashboard-section">
      <div className="section-title-row">
        <div>
          <h2>This week</h2>
          <p className="muted">{formatReviewWeek(currentWeekStart)}</p>
        </div>

        <button className="text-button" onClick={() => setTab("analytics")}>View analytics</button>
      </div>

      <div className="dashboard-grid">
        {showTrading && (
          <>
            <AnalyticsCard label="Week P&L" value={formatCurrency(dashboardWeeklySummary.totalPnl)} valueClass={dashboardWeeklySummary.totalPnl >= 0 ? "positive" : "negative"} />
            <AnalyticsCard label="Rule follow" value={dashboardWeeklySummary.ruleFollowRate > 0 ? `${dashboardWeeklySummary.ruleFollowRate.toFixed(0)}%` : "—"} />
          </>
        )}

        {showLearning && (
          <AnalyticsCard label="Study time" value={formatStudyMinutes(dashboardWeeklySummary.studyMinutes)} />
        )}

        <AnalyticsCard label="Days logged" value={`${dashboardWeeklySummary.loggedDays}/7`} />
      </div>
    </section>

    <section className="dashboard-section">
      <h2>Current focus</h2>
      <article className="card focus-card">
        <span className="focus-label">ONE THING FOR THIS WEEK</span>
        <p>{dashboardData.currentFocus}</p>
        <button className="secondary-button" onClick={() => setTab("review")}>Open Weekly Review</button>
      </article>
    </section>

    <section className="dashboard-section">
      <h2>Quick actions</h2>
      <div className="quick-actions">
        <button className="quick-action card" onClick={() => setTab("checkin")}>
          <CheckCircle2 size={22} />
          <span>Daily Check-in</span>
        </button>

        <button className="quick-action card" onClick={() => setTab("analytics")}>
          <TrendingUp size={22} />
          <span>Analytics</span>
        </button>

        <button className="quick-action card" onClick={() => setTab("review")}>
          <CalendarDays size={22} />
          <span>Weekly Review</span>
        </button>
      </div>
    </section>
  </section>
)}

        {/* DAILY CHECK-IN */}

        {tab === "checkin" && (
          <section className="page">
            <h1>Daily check-in</h1>
            <p className="muted">A losing day can still be a good process day.</p>

            <div className="card form-card">
              <DateInput label="Date" value={selectedDate} onChange={setSelectedDate} />

              {showTrading && (
                <>
                  <h2>Trading</h2>
                  <div className="two-col">
                    <label>
                      P&L (₹)
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder="e.g. 2000 or -1000"
                        value={form.pnl ?? ""}
                        onChange={(event) =>
                          update("pnl", event.target.value === "" ? null : Number(event.target.value))
                        }
                      />
                    </label>

                    <label>
                      Trades taken
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="0"
                        value={form.trades ?? ""}
                        onChange={(event) =>
                          update("trades", event.target.value === "" ? null : Number(event.target.value))
                        }
                      />
                    </label>
                  </div>

                  <Choice
                    label="Did you follow your trading rules?"
                    value={form.followedRules}
                    onChange={(value) => update("followedRules", value)}
                  />

                  <Choice
                    label="Any forced/revenge trade?"
                    value={form.forcedTrade}
                    onChange={(value) => update("forcedTrade", value)}
                  />
                </>
              )}

              {showLearning && (
                <>
                  <h2>Learning</h2>
                  <label>
                    What did you study or build?
                    <textarea
                      placeholder="Example: React hooks, Node.js API, DSA problem..."
                      value={form.studyTopic}
                      onChange={(event) => update("studyTopic", event.target.value)}
                    />
                  </label>

                  <label>
                    Study time (minutes)
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="45"
                      value={form.studyMinutes ?? ""}
                      onChange={(event) =>
                        update("studyMinutes", event.target.value === "" ? null : Number(event.target.value))
                      }
                    />
                  </label>
                </>
              )}

              {!showTrading && !showLearning && (
                <section className="empty card">
                  No tracking areas are enabled. Turn on at least one area in Settings to continue.
                </section>
              )}

              {(showTrading || showLearning) && (
                <>
                  <h2>Reflection</h2>

                  <label>
                    {reflectionPrompts.achievement}
                    <textarea value={form.achievement} onChange={(event) => update("achievement", event.target.value)} />
                  </label>

                  <label>
                    {reflectionPrompts.mistake}
                    <textarea value={form.mistake} onChange={(event) => update("mistake", event.target.value)} />
                  </label>

                  <label>
                    {reflectionPrompts.priority}
                    <textarea value={form.tomorrowPriority} onChange={(event) => update("tomorrowPriority", event.target.value)} />
                  </label>
                </>
              )}

              <button className="primary save-button" onClick={saveEntry} disabled={!showTrading && !showLearning}>
                Save check-in
              </button>

              {saveMessage && <p className="save-message">{saveMessage}</p>}
            </div>
          </section>
        )}

        {/* HISTORY */}

        {tab === "history" && (
          <section className="page">

            <h1>
              History
            </h1>

            <p className="muted">
              Your data matters more
              than your memory.
            </p>

            {entries.length === 0 ? (

              <section className="empty card">
                No entries yet.
                Start with today's
                check-in.
              </section>

            ) : (

              entries.map(
                (entry) => (

                  <article
                    className="history-card"
                    key={entry.date}
                  >

                    <div className="history-top">

                      <div>

                        <h2>
                          {new Date(
                            entry.date +
                              "T00:00:00"
                          ).toLocaleDateString(
                            "en-IN",
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            }
                          )}
                        </h2>

                        <p>
                          {entry.studyTopic ||
                            "No study entry"}
                        </p>

                      </div>

                      <strong
                        className={
                          (entry.pnl ?? 0) >=
                          0
                            ? "positive"
                            : "negative"
                        }
                      >
                        {entry.pnl === null
                          ? "—"
                          : formatCurrency(
                              entry.pnl
                            )}
                      </strong>

                    </div>

                    <div className="history-meta">

                      <span>
                        {
                          entry.studyMinutes ??
                          0
                        }{" "}
                        min study
                      </span>

                      <span>
                        {entry.followedRules ===
                        "yes"
                          ? "Rules followed"
                          : entry.followedRules ===
                            "no"
                          ? "Rules broken"
                          : "No rule data"}
                      </span>

                    </div>

                    <div className="history-actions">

                      <button
                        onClick={() => {
                          setSelectedDate(
                            entry.date
                          );

                          setTab(
                            "checkin"
                          );
                        }}
                      >
                        Edit
                      </button>

                      <button
                        className="danger"
                        onClick={() =>
                          deleteEntry(
                            entry.date
                          )
                        }
                      >
                        Delete
                      </button>

                    </div>

                  </article>
                )
              )
            )}

          </section>
        )}

        {/* ANALYTICS */}

        {tab === "analytics" && (
          <section className="page analytics-page">
            <h1>Analytics</h1>
            <p className="muted">Focus on patterns, not just P&amp;L.</p>
            <div className="analytics-filter">
              <button className={analyticsRange === "7d" ? "active" : ""} onClick={() => setAnalyticsRange("7d")}>7 Days</button>
              <button className={analyticsRange === "30d" ? "active" : ""} onClick={() => setAnalyticsRange("30d")}>30 Days</button>
              <button className={analyticsRange === "all" ? "active" : ""} onClick={() => setAnalyticsRange("all")}>All Time</button>
            </div>
            {entries.length === 0 ? (
              <section className="empty card">No data available yet. Complete a few daily check-ins first.</section>
            ) : (
              <>
                <h2 className="analytics-heading">Overview</h2>
                <div className="analytics-grid">
                  {showTrading && (
                    <>
                      <AnalyticsCard label="Total P&L" value={formatCurrency(analytics.totalPnl)} valueClass={analytics.totalPnl >= 0 ? "positive" : "negative"} />
                      <AnalyticsCard label="Average daily P&L" value={formatCurrency(analytics.averagePnl)} valueClass={analytics.averagePnl >= 0 ? "positive" : "negative"} />
                      <AnalyticsCard label="Rule follow rate" value={`${analytics.ruleFollowRate.toFixed(0)}%`} />
                      <AnalyticsCard label="Forced trades" value={String(analytics.forcedTradeCount)} />
                    </>
                  )}

                  {showLearning && (
                    <>
                      <AnalyticsCard label="Total study time" value={formatStudyMinutes(analytics.totalStudyMinutes)} />
                      <AnalyticsCard label="Study days" value={String(analytics.studyDays)} />
                      <AnalyticsCard label="Average study session" value={`${Math.round(analytics.averageStudyMinutes)} min`} />
                    </>
                  )}

                  <AnalyticsCard label="Days logged" value={String(analytics.loggedDays)} />
                </div>

                {showTrading && (
                  <>
                    <ChartCard title="P&L trend" subtitle="Your trading result over time.">
                      <LineChart data={analytics.pnlChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" /><YAxis /><Tooltip />
                        <Line type="monotone" dataKey="pnl" stroke="#86efac" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ChartCard>

                    <section className="card">
                      <h2>Trading discipline</h2>
                      <div className="discipline-grid">
                        <AnalyticsRow label="Profitable days" value={String(analytics.profitableDays)} />
                        <AnalyticsRow label="Losing days" value={String(analytics.losingDays)} />
                        <AnalyticsRow label="Breakeven days" value={String(analytics.breakevenDays)} />
                        <AnalyticsRow label="Win rate" value={`${analytics.winRate.toFixed(1)}%`} />
                        <AnalyticsRow label="Rules followed" value={`${analytics.ruleFollowRate.toFixed(1)}%`} />
                        <AnalyticsRow label="Forced / revenge trades" value={String(analytics.forcedTradeCount)} />
                      </div>
                    </section>
                  </>
                )}

                {showLearning && (
                  <>
                    <ChartCard title="Study consistency" subtitle="Minutes invested each day.">
                      <BarChart data={analytics.studyChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" /><YAxis /><Tooltip /><Legend />
                        <Bar dataKey="minutes" name="Study minutes" fill="#93c5fd" />
                      </BarChart>
                    </ChartCard>
                  </>
                )}

                {!showTrading && !showLearning && (
                  <section className="empty card">Enable a tracking area in Settings to view analytics.</section>
                )}
              </>
            )}
          </section>
        )}

        {/* WEEKLY REVIEW */}

        {tab === "review" && (
          <section className="page review-page">
            <h1>{selectedReviewWeek ? "Review History" : "Weekly Review"}</h1>
            <p className="muted">Review the week honestly. One improvement is enough.</p>

            <div className="review-week-selector">
              <div>
                <span className="muted">Reviewing</span>
                <h2>{formatReviewWeek(activeReviewWeek)}</h2>
              </div>

              {selectedReviewWeek && (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setSelectedReviewWeek(null);
                    setReviewMessage("");
                  }}
                >
                  Current Week
                </button>
              )}
            </div>

            {reviewsLoading ? (
              <section className="empty card">Loading review...</section>
            ) : (
              <>
                <section className="weekly-insights">
                  <h2>{selectedReviewWeek ? "Week's insights" : "This week's insights"}</h2>

                  {weeklyInsights.map((insight, index) => (
                    <article
                      key={`${insight.type}-${index}`}
                      className={`insight-card ${insight.type}`}
                    >
                      <div className="insight-content">
                        <h3>{insight.title}</h3>
                        <p>{insight.message}</p>
                      </div>
                    </article>
                  ))}
                </section>

                <section className="review-summary">
                  {showTrading && (
                    <>
                      <AnalyticsCard label="Week P&L" value={formatCurrency(weeklySummary.totalPnl)} valueClass={weeklySummary.totalPnl >= 0 ? "positive" : "negative"} />
                      <AnalyticsCard label="Win rate" value={`${weeklySummary.winRate.toFixed(0)}%`} />
                      <AnalyticsCard label="Rule follow" value={`${weeklySummary.ruleFollowRate.toFixed(0)}%`} />
                      <AnalyticsCard label="Forced trades" value={String(weeklySummary.forcedTrades)} />
                    </>
                  )}
                  {showLearning && <AnalyticsCard label="Study time" value={formatStudyMinutes(weeklySummary.studyMinutes)} />}
                  <AnalyticsCard label="Days logged" value={String(weeklySummary.loggedDays)} />
                </section>

                <section className="card review-form">
                  <h2>Weekly reflection</h2>

                  <label>
                    What went well?
                    <textarea
                      value={reviewForm.wentWell}
                      onChange={(event) => setReviewForm((previous) => ({ ...previous, wentWell: event.target.value }))}
                      placeholder="What did you do well this week?"
                      rows={4}
                    />
                  </label>

                  <label>
                    Biggest mistake or problem?
                    <textarea
                      value={reviewForm.biggestMistake}
                      onChange={(event) => setReviewForm((previous) => ({ ...previous, biggestMistake: event.target.value }))}
                      placeholder="Be specific. What should not happen again?"
                      rows={4}
                    />
                  </label>

                  <label>
                    What did you achieve in upskilling?
                    <textarea
                      value={reviewForm.upskillingAchievement}
                      onChange={(event) => setReviewForm((previous) => ({ ...previous, upskillingAchievement: event.target.value }))}
                      placeholder="What did you learn, build, or complete?"
                      rows={4}
                    />
                  </label>

                  <label>
                    Next week's ONE main focus
                    <textarea
                      value={reviewForm.nextWeekFocus}
                      onChange={(event) => setReviewForm((previous) => ({ ...previous, nextWeekFocus: event.target.value }))}
                      placeholder="One thing that matters most next week."
                      rows={3}
                    />
                  </label>

                  <label>
                    Self-rating
                    <select
                      value={reviewForm.selfRating}
                      onChange={(event) => setReviewForm((previous) => ({ ...previous, selfRating: event.target.value }))}
                    >
                      <option value="">Select rating</option>
                      {Array.from({ length: 10 }, (_, index) => index + 1).map((rating) => (
                        <option key={rating} value={rating}>{rating}/10</option>
                      ))}
                    </select>
                  </label>

                  <button
                    className="primary save-button"
                    onClick={handleSaveWeeklyReview}
                    disabled={reviewSaving}
                  >
                    {reviewSaving ? "Saving..." : "Save Weekly Review"}
                  </button>

                  {reviewMessage && <p className="save-message">{reviewMessage}</p>}
                </section>

                <section className="review-history">
                  <div className="review-history-header">
                    <h2>Previous reviews</h2>
                    <span className="muted">{weeklyReviews.length} saved</span>
                  </div>

                  {weeklyReviews.length === 0 ? (
                    <section className="empty card">No weekly reviews yet.</section>
                  ) : (
                    <div className="review-history-list">
                      {weeklyReviews
                        .filter((review) => review.weekStart !== activeReviewWeek)
                        .map((review) => (
                          <article className="review-history-item card" key={review.id}>
                            <button
                              className="review-history-main"
                              onClick={() => {
                                setSelectedReviewWeek(review.weekStart);
                                setReviewMessage("");
                              }}
                            >
                              <div>
                                <strong>{formatReviewWeek(review.weekStart)}</strong>
                                {review.nextWeekFocus && (
                                  <p>Focus: {review.nextWeekFocus}</p>
                                )}
                              </div>

                              {review.selfRating && (
                                <span className="review-rating">{review.selfRating}/10</span>
                              )}
                            </button>

                            <button
                              className="danger review-delete"
                              onClick={() => handleDeleteWeeklyReview(review)}
                            >
                              Delete
                            </button>
                          </article>
                        ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </section>
        )}

        {tab === "settings" && (
          <section className="page goals-page">
            <div className="goals-page-header">
              <div>
                <p className="muted">Preferences</p>
                <h1>Tracking Areas</h1>
              </div>
            </div>

            <p className="muted goals-intro">
              Choose what you want to track. The dashboard, check-in, analytics, and review adapt to the modules you enable.
            </p>

            <section className="card settings-area-list">
              {TRACKING_AREAS.map((area) => {
                const active = enabledAreas.includes(area.id);

                return (
                  <button
                    key={area.id}
                    type="button"
                    className={`settings-area-toggle ${active ? "active" : ""}`}
                    onClick={() => toggleTrackingArea(area.id)}
                  >
                    <div className="settings-area-copy">
                      <span className="settings-area-name">{area.label}</span>
                      <span className="settings-area-description">{area.description}</span>
                    </div>
                    <span className={`settings-area-status ${active ? "enabled" : "disabled"}`}>
                      {active ? "Enabled" : "Disabled"}
                    </span>
                  </button>
                );
              })}
            </section>
          </section>
        )}

        {/* GOALS */}

        {tab === "goals" && (
          <section className="page goals-page">
            <div className="goals-page-header">
              <div>
                <p className="muted">
                  {new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
                </p>
                <h1>Monthly goals</h1>
              </div>
            </div>

            <p className="muted goals-intro">
              These goals update automatically from your daily check-ins. The point is to measure execution, not create another list you need to maintain.
            </p>

            <section className="card goals-target-editor">
              <div className="goals-target-editor-header">
                <div>
                  <span className="goals-summary-label">Monthly targets</span>
                  <strong>Adjust what matters this month</strong>
                </div>

                <button className="secondary-button small-button" onClick={resetMonthlyGoals} type="button">Reset</button>
              </div>

              <div className="goals-target-grid">
                {showTrading && (
                  <label>
                    Trading P&L target
                    <input type="number" min="0" value={monthlyGoalTargets.tradingPnl} onChange={(event) => updateMonthlyGoalTarget("tradingPnl", event.target.value)} />
                  </label>
                )}

                {showLearning && (
                  <label>
                    Study hours
                    <input type="number" min="1" value={monthlyGoalTargets.studyHours} onChange={(event) => updateMonthlyGoalTarget("studyHours", event.target.value)} />
                  </label>
                )}

                <label>
                  Check-in days
                  <input type="number" min="1" value={monthlyGoalTargets.checkinDays} onChange={(event) => updateMonthlyGoalTarget("checkinDays", event.target.value)} />
                </label>
              </div>

              {monthlyGoalMessage && <p className="save-message">{monthlyGoalMessage}</p>}
            </section>

            <section className="goals-summary card">
              <div>
                <span className="goals-summary-label">This month's execution</span>
                <strong>{monthlyProgress.checkinDays} days logged</strong>
              </div>

              <button className="secondary-button" onClick={() => setTab("checkin")}>Add check-in</button>
            </section>

            {showTrading && (
              <GoalProgressCard
                icon={<TrendingUp size={22} />}
                title="Trading performance"
                description="Track monthly net P&L. Do not force trades just to reach the target."
                currentLabel={formatCurrency(goalsProgress.trading.current)}
                targetLabel={formatCurrency(goalsProgress.trading.target)}
                percentage={goalsProgress.trading.percentage}
                status={goalsProgress.trading.current > 0 ? "positive" : goalsProgress.trading.current < 0 ? "negative" : "neutral"}
              />
            )}

            {showLearning && (
              <GoalProgressCard
                icon={<BarChart3 size={22} />}
                title="Upskilling"
                description="Focused learning time logged this month."
                currentLabel={`${Math.floor(goalsProgress.upskilling.current / 60)}h ${goalsProgress.upskilling.current % 60}m`}
                targetLabel={`${monthlyGoalTargets.studyHours}h`}
                percentage={goalsProgress.upskilling.percentage}
                status={goalsProgress.upskilling.percentage >= 100 ? "positive" : "neutral"}
              />
            )}

            <GoalProgressCard
              icon={<CheckCircle2 size={22} />}
              title="Consistency"
              description="Complete your daily check-in and build the habit of showing up."
              currentLabel={`${goalsProgress.consistency.current} days`}
              targetLabel={`${goalsProgress.consistency.target} days`}
              percentage={goalsProgress.consistency.percentage}
              status={goalsProgress.consistency.percentage >= 100 ? "positive" : "neutral"}
            />

            {(!showTrading && !showLearning) && (
              <section className="empty card">No tracking areas are enabled. Turn one on in Settings to start building goals.</section>
            )}

            <section className="card goals-rule-card">
              <Target size={20} />
              <div>
                <strong>One rule</strong>
                <p>If you miss a target, change the execution—not the target.</p>
              </div>
            </section>
          </section>
        )}

      </main>

      {/* BOTTOM NAVIGATION */}

      <nav className="bottom-nav">

        <NavButton
          active={
            tab === "dashboard"
          }
          icon={<Home size={20} />}
          label="Home"
          onClick={() =>
            setTab("dashboard")
          }
        />

        <NavButton
          active={
            tab === "checkin"
          }
          icon={
            <CheckCircle2 size={20} />
          }
          label="Check-in"
          onClick={() =>
            setTab("checkin")
          }
        />

        <NavButton
          active={
            tab === "history"
          }
          icon={
            <CalendarDays size={20} />
          }
          label="History"
          onClick={() =>
            setTab("history")
          }
        />

        <NavButton
          active={tab === "analytics"}
          icon={<TrendingUp size={20} />}
          label="Analytics"
          onClick={() => setTab("analytics")}
        />

        <NavButton
          active={tab === "review"}
          icon={<CalendarDays size={20} />}
          label="Review"
          onClick={() => setTab("review")}
        />

        <NavButton
          active={
            tab === "goals"
          }
          icon={<Target size={20} />}
          label="Goals"
          onClick={() =>
            setTab("goals")
          }
        />

        <NavButton
          active={tab === "settings"}
          icon={<Target size={20} />}
          label="Settings"
          onClick={() => setTab("settings")}
        />

      </nav>

    </div>
  );
}

type GoalProgressCardProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  currentLabel: string;
  targetLabel: string;
  percentage: number;
  status?: "positive" | "negative" | "neutral";
};

function GoalProgressCard({
  icon,
  title,
  description,
  currentLabel,
  targetLabel,
  percentage,
  status = "neutral",
}: GoalProgressCardProps) {
  return (
    <section className="card measurable-goal-card">
      <div className="goal-card-header">
        <div className="goal-icon">
          {icon}
        </div>

        <div className="goal-card-content">
          <h2>{title}</h2>

          <p>{description}</p>
        </div>
      </div>

      <div className="goal-progress-numbers">
        <div>
          <span className="goal-current-label">
            Current
          </span>

          <strong
            className={
              status === "positive"
                ? "positive"
                : status === "negative"
                ? "negative"
                : ""
            }
          >
            {currentLabel}
          </strong>
        </div>

        <div className="goal-target">
          <span>Target</span>

          <strong>
            {targetLabel}
          </strong>
        </div>
      </div>

      <div
        className="goal-progress-bar"
        aria-label={`${percentage.toFixed(
          0
        )}% complete`}
      >
        <div
          className={`goal-progress-fill ${
            status === "positive"
              ? "positive"
              : status === "negative"
              ? "negative"
              : ""
          }`}
          style={{
            width: `${percentage}%`,
          }}
        />
      </div>

      <div className="goal-progress-footer">
        <span>
          {percentage.toFixed(0)}% complete
        </span>

        <span>
          {percentage >= 100
            ? "Target reached"
            : "In progress"}
        </span>
      </div>
    </section>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const openPicker = (
    event: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>
  ) => {
    const input = (event.currentTarget.parentElement?.querySelector(
      "input[type='date']"
    ) as HTMLInputElement | null);

    if (!input) return;

    if (typeof input.showPicker === "function") {
      input.showPicker();
    }
  };

  return (
    <label className="date-field">
      <span>{label}</span>

      <div
        className="date-input-wrap"
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker(event);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={label}
      >
        <input
          type="date"
          value={value}
          inputMode="none"
          onFocus={(event) => {
            const input = event.currentTarget as HTMLInputElement & {
              showPicker?: () => void;
            };

            if (typeof input.showPicker === "function") {
              input.showPicker();
            }
          }}
          onClick={(event) => {
            const input = event.currentTarget as HTMLInputElement & {
              showPicker?: () => void;
            };

            if (typeof input.showPicker === "function") {
              input.showPicker();
            }
          }}
          onChange={(event) =>
            onChange(event.target.value)
          }
        />

        <CalendarDays className="date-input-icon" size={18} aria-hidden="true" />
      </div>
    </label>
  );
}

function GoalCard({
  goal,
  onToggle,
  onEdit,
  onDelete,
}: {
  goal: Goal;
  onToggle: (goal: Goal) => void;
  onEdit?: (goal: Goal) => void;
  onDelete: (id: string) => void;
}) {
  const completed = goal.status === "completed";

  return (
    <article className={`goal-item card${completed ? " completed-goal" : ""}`}>
      <div className="goal-top">
        <div>
          <span className={`goal-category ${goal.category}`}>{goal.category}</span>
          <h2>{goal.title}</h2>
        </div>
      </div>
      {!completed && goal.target && <p className="goal-detail"><strong>Target:</strong> {goal.target}</p>}
      {!completed && goal.deadline && <p className="goal-detail"><strong>Deadline:</strong> {new Date(`${goal.deadline}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>}
      <div className="goal-actions">
        <button onClick={() => onToggle(goal)}>{completed ? "Reopen" : "Complete"}</button>
        {onEdit && <button onClick={() => onEdit(goal)}>Edit</button>}
        <button className="danger" onClick={() => onDelete(goal.id)}>Delete</button>
      </div>
    </article>
  );
}

function AnalyticsCard({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return <div className="analytics-metric"><span>{label}</span><strong className={valueClass}>{value}</strong></div>;
}

function AnalyticsRow({ label, value }: { label: string; value: string }) {
  return <div className="analytics-row"><span>{label}</span><strong>{value}</strong></div>;
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactElement;
}) {
  return (
    <section className="card chart-card">
      <div className="chart-header"><h2>{title}</h2><p className="muted">{subtitle}</p></div>
      <div className="chart-container"><ResponsiveContainer width="100%" height={280}>{children}</ResponsiveContainer></div>
    </section>
  );
}

// -------------------------
// METRIC COMPONENT
// -------------------------

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="metric">

      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>

    </div>
  );
}

// -------------------------
// YES / NO COMPONENT
// -------------------------

function Choice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "yes" | "no" | "";
  onChange: (
    value: "yes" | "no" | ""
  ) => void;
}) {
  return (
    <div className="choice-group">

      <span>
        {label}
      </span>

      <div>

        <button
          type="button"
          className={
            value === "yes"
              ? "selected yes"
              : ""
          }
          onClick={() =>
            onChange("yes")
          }
        >
          Yes
        </button>

        <button
          type="button"
          className={
            value === "no"
              ? "selected no"
              : ""
          }
          onClick={() =>
            onChange("no")
          }
        >
          No
        </button>

      </div>

    </div>
  );
}

// -------------------------
// NAVIGATION BUTTON
// -------------------------

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={
        active ? "nav-active" : ""
      }
      onClick={onClick}
    >
      {icon}

      <span>
        {label}
      </span>

    </button>
  );
}

createRoot(
  document.getElementById("root")!
).render(<App />);
