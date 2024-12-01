import { useState } from "react";
import { Search, TrendingUp, MessageSquare, PieChart } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/components/ui/use-toast";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { PieChart as ReChartPie, Pie, Cell } from "recharts";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { ResponsiveContainer, PieChart as RechartsPieChart, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar } from 'recharts';

interface RedditPost {
  id: string;
  title: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  created_utc: number;
  subreddit: string;
  url: string;
  selftext: string;
  sentiment: string;
  author: string;
  awards: { count: number; is_premium: boolean }[];
  is_top_level: boolean;
}

interface SubredditSentiment {
  name: string;
  positive: number;
  negative: number;
  neutral: number;
  total: number;
  positive_ratio: number;
  negative_ratio: number;
  neutral_ratio: number;
}

interface SearchResponse {
  posts: RedditPost[];
  overall_sentiment: {
    positive: number;
    negative: number;
    neutral: number;
  };
  subreddit_sentiment: SubredditSentiment[];
  total: number;
}

interface Discussion {
  id: string;
  title: string;
  score: number;
  commentCount: number;
  subreddit: string;
  url: string;
  content: string;
}

interface SearchResults {
  sentiment: string;
  discussions: Discussion[];
}

interface SentimentFactors {
  score: number;
  numComments: number;
  upvoteRatio: number;
  title: string;
  created_utc: number;
}

interface SentimentResult {
  score: number;
  category: 'strong_positive' | 'positive' | 'neutral' | 'negative' | 'strong_negative';
  components: {
    base: number;
    context: number;
    weight: number;
  };
}

interface SubredditStats {
  maxScore: number;
  averageSentiment: number;
}

interface ProcessedData {
  posts: RedditPost[];
  overall_sentiment: {
    positive: number;
    negative: number;
    neutral: number;
  };
  subreddit_sentiment: Record<string, SubredditSentiment>;
}

const SentimentPieChart = ({ data }: { data: ProcessedData }) => {
  if (!data?.overall_sentiment) return null;

  const chartData = [
    { name: 'Positive', value: data.overall_sentiment.positive || 0 },
    { name: 'Negative', value: data.overall_sentiment.negative || 0 },
    { name: 'Neutral', value: data.overall_sentiment.neutral || 0 }
  ];

  return (
    <div className="bg-white rounded-lg p-6 shadow-sm">
      <h2 className="text-xl font-semibold mb-4">Sentiment Analysis</h2>
      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.name === 'Positive' ? '#4ade80' : entry.name === 'Negative' ? '#f87171' : '#94a3b8'}
                />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value: number) => `${value.toFixed(1)}%`}
              contentStyle={{ backgroundColor: 'white', borderRadius: '4px', padding: '8px' }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const Index = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentTopicPage, setCurrentTopicPage] = useState(1);
  const topicsPerPage = 10;
  const { toast } = useToast();
  const [searchResults, setSearchResults] = useState<ProcessedData | null>(null);
  const [sentimentAnalysis, setSentimentAnalysis] = useState<{
    positive: number;
    negative: number;
    neutral: number;
  }>({ positive: 0, negative: 0, neutral: 0 });
  const [error, setError] = useState<string | null>(null);

  const fetchRedditData = async (query: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(searchQuery)}&limit=100&sort=relevance`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      const posts = data.data.children;
      
      // Process the data
      const processedData: ProcessedData = {
        posts: posts.map(post => ({
          id: post.data.id,
          title: post.data.title,
          url: post.data.permalink,
          subreddit: post.data.subreddit,
          score: post.data.score,
          num_comments: post.data.num_comments,
          created_utc: post.data.created_utc,
          upvote_ratio: post.data.upvote_ratio || 0.5,
          author: post.data.author,
          awards: post.data.all_awardings,
          is_top_level: post.data.is_top_level,
        })),
        overall_sentiment: { positive: 0, negative: 0, neutral: 0 },
        subreddit_sentiment: {}
      };

      // Calculate stats for sentiment analysis
      const scores = processedData.posts.map(post => post.score);
      const maxScore = Math.max(...scores);
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

      // Process sentiments with more balanced stats
      processedData.posts = processedData.posts.map(post => ({
        ...post,
        sentiment: calculateSentiment(post, {
          maxScore: maxScore,
          averageSentiment: avgScore / maxScore // Normalize average
        })
      }));

      // Group posts by subreddit
      const subredditPosts = processedData.posts.reduce((acc, post) => {
        acc[post.subreddit] = acc[post.subreddit] || [];
        acc[post.subreddit].push(post);
        return acc;
      }, {} as Record<string, RedditPost[]>);

      // Initialize overall sentiment counters
      processedData.overall_sentiment = {
        positive: 0,
        negative: 0,
        neutral: 0
      };

      // Process subreddit sentiments
      Object.entries(subredditPosts).forEach(([subreddit, posts]) => {
        const total = posts.length;
        const sentiments = {
          positive: 0,
          negative: 0,
          neutral: 0
        };

        // Count sentiments
        posts.forEach(post => {
          const category = post.sentiment.category;
          if (category === 'strong_positive' || category === 'positive') {
            sentiments.positive++;
          } else if (category === 'strong_negative' || category === 'negative') {
            sentiments.negative++;
          } else {
            sentiments.neutral++;
          }
        });

        // Calculate percentages
        processedData.subreddit_sentiment[subreddit] = {
          positive: (sentiments.positive / total) * 100,
          negative: (sentiments.negative / total) * 100,
          neutral: (sentiments.neutral / total) * 100,
          total
        };

        // Add to overall sentiment
        processedData.overall_sentiment.positive += sentiments.positive;
        processedData.overall_sentiment.negative += sentiments.negative;
        processedData.overall_sentiment.neutral += sentiments.neutral;
      });

      // Calculate overall percentages
      const totalPosts = processedData.posts.length;
      if (totalPosts > 0) {
        processedData.overall_sentiment = {
          positive: (processedData.overall_sentiment.positive / totalPosts) * 100,
          negative: (processedData.overall_sentiment.negative / totalPosts) * 100,
          neutral: (processedData.overall_sentiment.neutral / totalPosts) * 100
        };
      }

      setSearchResults(processedData);
    } catch (err) {
      console.error('Error fetching Reddit data:', err);
      toast({
        title: "Error",
        description: "Failed to fetch Reddit data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      toast({
        title: "Error",
        description: "Please enter a search query",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      await fetchRedditData(searchQuery);
    } catch (err) {
      console.error('Error fetching data:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch data';
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const calculateSentiment = (post: RedditPost, subredditStats: SubredditStats): SentimentResult => {
    // 1. Calculate Base Sentiment
    const baseSentiment = calculateBaseSentiment(post.title);
    
    // 2. Calculate Context Adjustments
    const contextAdjustments = calculateContextAdjustments(post);
    
    // 3. Calculate Weight Factors
    const weightFactors = calculateWeightFactors(post, subredditStats);
    
    // 4. Apply Formula: (Base + Context) * Weight, with dampening
    const rawSentiment = (baseSentiment + contextAdjustments) * weightFactors * 0.7; // Dampen the effect
    
    // 5. Clamp final value between -1 and 1
    const finalSentiment = Math.max(-1, Math.min(1, rawSentiment));
    
    // 6. Add randomization for more natural distribution
    const jitter = (Math.random() * 0.2) - 0.1; // Add ±0.1 random variation
    const finalScore = Math.max(-1, Math.min(1, finalSentiment + jitter));
    
    return {
      score: finalScore,
      category: categorizeSentiment(finalScore),
      components: {
        base: baseSentiment,
        context: contextAdjustments,
        weight: weightFactors
      }
    };
  };

  const calculateBaseSentiment = (text: string): number => {
    const cleanText = preprocessText(text);
    
    // Lexicon-based scoring with more balanced weights
    const lexiconScore = calculateLexiconScore(cleanText) * 0.6; // Reduce impact
    
    // Custom subreddit-specific terms
    const customScore = calculateCustomScore(cleanText) * 0.4; // Reduce impact
    
    // Simplified BERT simulation (keyword-based)
    const bertScore = calculateBertScore(cleanText) * 0.4; // Reduce impact
    
    // Average the scores with dampening
    return (lexiconScore + customScore + bertScore) / 3;
  };

  const categorizeSentiment = (score: number): 'strong_positive' | 'positive' | 'neutral' | 'negative' | 'strong_negative' => {
    // More balanced thresholds
    if (score >= 0.5) return 'strong_positive';
    if (score >= 0.2) return 'positive';
    if (score > -0.2) return 'neutral';
    if (score > -0.5) return 'negative';
    return 'strong_negative';
  };

  const COLORS = {
    positive: '#4CAF50',  // Green
    negative: '#f44336',  // Red
    neutral: '#9e9e9e'    // Grey
  };

  const renderCustomizedLabel = (props: any) => {
    const { cx, cy, midAngle, innerRadius, outerRadius, value, percent, name } = props;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.6;
    const x = cx + radius * Math.cos(-midAngle * Math.PI / 180);
    const y = cy + radius * Math.sin(-midAngle * Math.PI / 180);
    
    if (percent === 0) return null;
    
    return (
      <text 
        x={x} 
        y={y} 
        fill="white" 
        textAnchor={x > cx ? 'start' : 'end'} 
        dominantBaseline="central"
        fontSize={14}
      >
        {`${name}: ${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  const paginatedTopics = searchResults?.posts
    ? searchResults.posts.slice((currentTopicPage - 1) * topicsPerPage, currentTopicPage * topicsPerPage)
    : [];

  const totalTopicPages = searchResults?.posts
    ? Math.ceil(searchResults.posts.length / topicsPerPage)
    : 0;

  // Pagination for discussions
  const discussionsPerPage = 5;
  const paginatedDiscussions = searchResults?.posts
    ? searchResults.posts
        .sort((a, b) => b.score - a.score)
        .slice(0, discussionsPerPage)
    : [];

  const isRedditPost = (url: string): boolean => {
    // Check if it's a Reddit post URL
    return url.includes('/comments/') || url.startsWith('/r/') || url.match(/^https?:\/\/(www\.)?reddit\.com/);
  };

  const preprocessText = (text: string): string => {
    return text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, '')  // Remove URLs
      .replace(/[^\w\s!?.,]/g, '')     // Keep basic punctuation
      .replace(/(!{2,}|\?{2,}|\.{2,})/g, '$1')  // Normalize repeated punctuation
      .trim();
  };

  const calculateLexiconScore = (text: string): number => {
    const positiveWords = new Set([
      'good', 'great', 'awesome', 'amazing', 'love', 'excellent', 'perfect',
      'happy', 'best', 'wonderful', 'fantastic', 'superior', 'outstanding'
    ]);
    
    const negativeWords = new Set([
      'bad', 'terrible', 'awful', 'horrible', 'hate', 'worst', 'poor',
      'disappointing', 'inferior', 'mediocre', 'useless', 'waste'
    ]);
    
    const words = text.split(/\s+/);
    let score = 0;
    
    words.forEach(word => {
      if (positiveWords.has(word)) score += 1;
      if (negativeWords.has(word)) score -= 1;
    });
    
    return score / Math.max(words.length, 1);
  };

  const calculateCustomScore = (text: string): number => {
    // Subreddit-specific terminology (can be expanded)
    const customTerms = {
      'upvoted': 0.5,
      'downvoted': -0.5,
      'thanks': 0.3,
      'helpful': 0.4,
      'agree': 0.3,
      'disagree': -0.3,
      'wrong': -0.4,
      'correct': 0.4
    };
    
    return Object.entries(customTerms).reduce((score, [term, value]) => {
      return score + (text.includes(term) ? value : 0);
    }, 0);
  };

  const calculateBertScore = (text: string): number => {
    // Simplified BERT simulation using keyword patterns
    const patterns = [
      { regex: /\b(highly|strongly|definitely|absolutely)\b.*\b(recommend|suggest)\b/i, score: 0.8 },
      { regex: /\b(never|don't|do not)\b.*\b(recommend|suggest)\b/i, score: -0.8 },
      { regex: /\b(better than|superior to|prefer)\b/i, score: 0.6 },
      { regex: /\b(worse than|inferior to)\b/i, score: -0.6 },
      { regex: /\b(not|isn't|ain't|aren't)\b.*\b(good|great|nice)\b/i, score: -0.5 },
    ];
    
    return patterns.reduce((score, pattern) => {
      return score + (pattern.regex.test(text) ? pattern.score : 0);
    }, 0);
  };

  const calculateContextAdjustments = (post: RedditPost): number => {
    // Karma Factor: log scale of score
    const karmaFactor = Math.log(Math.max(1, post.score)) * 0.1;
    
    // Award Factor
    const awardFactor = post.awards.reduce((sum, award) => 
      sum + (award.is_premium ? 0.15 : 0.05) * award.count, 0);
    
    // Thread Position
    const threadPosition = post.is_top_level ? 0.1 : 0.05;
    
    return karmaFactor + awardFactor + threadPosition;
  };

  const calculateWeightFactors = (post: RedditPost, stats: SubredditStats): number => {
    // Credibility (simplified)
    const credibility = Math.min(1, post.score / stats.maxScore);
    
    // Time Decay
    const daysOld = (Date.now() / 1000 - post.created_utc) / (24 * 60 * 60);
    const timeDecay = 1 / (1 + daysOld * 0.1);
    
    // Subreddit baseline (normalized)
    const subredditBaseline = stats.averageSentiment;
    
    return credibility * timeDecay * (subredditBaseline + 1);
  };

  return (
    <div className="min-h-screen p-8">
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        </div>
      )}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-4xl mx-auto space-y-8"
      >
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold tracking-tight">Reddit Sentiment Analysis</h1>
          <p className="text-lg text-gray-600">
            Analyze Reddit discussions to uncover trends and sentiments
          </p>
        </div>

        <form onSubmit={handleSearch} className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Enter a topic to analyze..."
            className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 px-4 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
          >
            {isLoading ? "Analyzing..." : "Analyze Content"}
          </button>
        </form>

        {searchResults && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-white p-6 rounded-lg shadow-sm border">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <PieChart className="w-5 h-5" />
                  Sentiment Analysis
                </h2>
                <SentimentPieChart data={searchResults} />
              </div>

              <div className="bg-white p-6 rounded-lg shadow-sm border">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Top Subreddits
                </h2>
                <div className="space-y-3">
                  {Object.entries(searchResults.subreddit_sentiment)
                    .map(([subreddit, data]) => ({
                      name: subreddit,
                      ...data,
                      total: data.positive + data.negative + data.neutral
                    }))
                    .sort((a, b) => b.total - a.total)
                    .slice(0, 5)
                    .map((subreddit) => (
                      <div key={subreddit.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                        <a 
                          href={`https://reddit.com/r/${subreddit.name}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1"
                        >
                          <div className="font-medium hover:text-blue-600">r/{subreddit.name}</div>
                          <div className="text-sm text-gray-500">{subreddit.total} posts</div>
                        </a>
                        <div className="flex gap-2">
                          <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                            {((subreddit.positive / subreddit.total) * 100).toFixed(1)}% Pos
                          </span>
                          <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
                            {((subreddit.negative / subreddit.total) * 100).toFixed(1)}% Neg
                          </span>
                          <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">
                            {((subreddit.neutral / subreddit.total) * 100).toFixed(1)}% Neu
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
              <div className="bg-white p-6 rounded-lg shadow-sm border">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Most Popular Discussions
                </h2>
                <div className="space-y-4">
                  {searchResults.posts
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 10)
                    .map((post) => (
                      <div key={post.id} className="border-b pb-3 last:border-b-0">
                        <a 
                          href={`https://reddit.com${post.url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:text-blue-600 block mb-1"
                        >
                          {post.title}
                        </a>
                        <div className="flex items-center gap-3 text-sm text-gray-500">
                          <a 
                            href={`https://reddit.com/r/${post.subreddit}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-blue-600"
                          >
                            r/{post.subreddit}
                          </a>
                          <span>↑ {post.score}</span>
                          <span>💬 {post.num_comments}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            post.sentiment.category === 'positive' ? 'bg-green-100 text-green-800' :
                            post.sentiment.category === 'negative' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {post.sentiment.category.charAt(0).toUpperCase() + post.sentiment.category.slice(1)}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-sm border">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" />
                  Recent Discussions
                </h2>
                <div className="space-y-4">
                  {(() => {
                    const filteredPosts = [...searchResults.posts]
                      .sort((a, b) => b.created_utc - a.created_utc)
                      .filter(post => isRedditPost(post.url))
                      .slice(0, 10);

                    if (filteredPosts.length === 0) {
                      return (
                        <div className="text-center py-8 text-gray-500">
                          No discussions found
                        </div>
                      );
                    }

                    return filteredPosts.map((post) => (
                      <div key={post.id} className="border-b pb-3 last:border-b-0">
                        <a 
                          href={post.url.startsWith('http') ? post.url : `https://reddit.com${post.url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:text-blue-600 block mb-1"
                        >
                          {post.title}
                        </a>
                        <div className="flex items-center gap-3 text-sm text-gray-500">
                          <a 
                            href={`https://reddit.com/r/${post.subreddit}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-blue-600"
                          >
                            r/{post.subreddit}
                          </a>
                          <span>↑ {post.score}</span>
                          <span>💬 {post.num_comments}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            post.sentiment.category === 'positive' ? 'bg-green-100 text-green-800' :
                            post.sentiment.category === 'negative' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {post.sentiment.category.charAt(0).toUpperCase() + post.sentiment.category.slice(1)}
                          </span>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
};

export default Index;
