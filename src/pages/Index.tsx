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

const Index = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentTopicPage, setCurrentTopicPage] = useState(1);
  const topicsPerPage = 10;
  const { toast } = useToast();
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
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
      const processedData = {
        posts: posts.map(post => ({
          id: post.data.id,
          title: post.data.title,
          url: post.data.permalink,
          subreddit: post.data.subreddit,
          score: post.data.score,
          num_comments: post.data.num_comments,
          created_utc: post.data.created_utc,
          upvote_ratio: post.data.upvote_ratio || 0.5
        })),
        overall_sentiment: { positive: 0, negative: 0, neutral: 0 },
        subreddit_sentiment: {}
      };

      // Calculate averages for normalization
      const scores = processedData.posts.map(post => post.score);
      const comments = processedData.posts.map(post => post.num_comments);
      const medianScore = scores.sort((a, b) => a - b)[Math.floor(scores.length / 2)];
      const avgComments = comments.reduce((a, b) => a + b, 0) / comments.length;

      // Assign sentiment to each post
      processedData.posts = processedData.posts.map(post => ({
        ...post,
        sentiment: calculateSentiment({
          score: post.score,
          numComments: post.num_comments,
          upvoteRatio: post.upvote_ratio,
          title: post.title,
          created_utc: post.created_utc
        }, medianScore, avgComments)
      }));

      // Calculate sentiments per subreddit
      const subredditPosts = {};
      processedData.posts.forEach(post => {
        if (!subredditPosts[post.subreddit]) {
          subredditPosts[post.subreddit] = [];
        }
        subredditPosts[post.subreddit].push(post);
      });

      // Calculate sentiment statistics
      Object.entries(subredditPosts).forEach(([subreddit, posts]) => {
        const total = posts.length;
        const sentiments = posts.reduce((acc, post) => {
          acc[post.sentiment]++;
          return acc;
        }, { positive: 0, negative: 0, neutral: 0 });

        processedData.subreddit_sentiment[subreddit] = {
          ...sentiments,
          total,
          name: subreddit
        };

        // Update overall sentiment
        processedData.overall_sentiment.positive += sentiments.positive;
        processedData.overall_sentiment.negative += sentiments.negative;
        processedData.overall_sentiment.neutral += sentiments.neutral;
      });

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

  const renderSentimentChart = () => {
    if (!searchResults?.overall_sentiment) {
      return null;
    }

    const { positive, negative, neutral } = searchResults.overall_sentiment;
    const total = positive + negative + neutral;
    
    if (total === 0) {
      return (
        <div className="w-full h-[250px] flex items-center justify-center text-gray-500">
          No sentiment data available
        </div>
      );
    }

    const data = [
      { 
        name: 'Positive', 
        value: positive,
        percentage: ((positive / total) * 100).toFixed(1)
      },
      { 
        name: 'Negative', 
        value: negative,
        percentage: ((negative / total) * 100).toFixed(1)
      },
      { 
        name: 'Neutral', 
        value: neutral,
        percentage: ((neutral / total) * 100).toFixed(1)
      }
    ];

    const COLORS = ['#10B981', '#EF4444', '#6B7280'];

    return (
      <div className="w-full h-[300px] flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsPieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey="value"
              label={({ name, percentage }) => `${name}: ${percentage}%`}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-white p-2 rounded-lg border shadow-sm">
                      <p className="text-sm font-medium">
                        {`${data.name}: ${data.percentage}% (${data.value} posts)`}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend />
          </RechartsPieChart>
        </ResponsiveContainer>
      </div>
    );
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

  const calculateSentimentScore = ({
    score,
    numComments,
    upvoteRatio,
    title,
    created_utc
  }: SentimentFactors, medianScore: number, avgComments: number): number => {
    // 1. Engagement Score (-1 to 1)
    const normalizedScore = score / (medianScore || 1);
    const normalizedComments = numComments / (avgComments || 1);
    const engagementScore = (normalizedScore * 0.6) + (normalizedComments * 0.4);
    
    // 2. Content Tone Score (-1 to 1)
    const toneScore = analyzeTone(title);
    
    // 3. User Interaction Score (-1 to 1)
    const interactionScore = calculateInteractionScore(upvoteRatio);
    
    // 4. Recency Score (0 to 0.5)
    const recencyScore = calculateRecencyScore(created_utc);
    
    // Weighted combination of all factors
    return (
      engagementScore * 0.35 +    // Engagement weight
      toneScore * 0.30 +          // Content tone weight
      interactionScore * 0.25 +   // User interaction weight
      recencyScore * 0.10         // Recency weight
    );
  };

  const analyzeTone = (text: string): number => {
    const positiveWords = ['good', 'great', 'awesome', 'amazing', 'love', 'best', 'excellent', 'perfect', 'helpful', 'recommended'];
    const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'worst', 'poor', 'disappointing', 'avoid', 'waste'];
    
    const lowercaseText = text.toLowerCase();
    let score = 0;
    
    // Check for positive/negative words
    positiveWords.forEach(word => {
      if (lowercaseText.includes(word)) score += 0.2;
    });
    
    negativeWords.forEach(word => {
      if (lowercaseText.includes(word)) score -= 0.2;
    });
    
    // Check for punctuation sentiment
    if (text.includes('!')) score += 0.1;
    if (text.includes('?')) score -= 0.05;
    if (text.includes('...')) score -= 0.1;
    
    // Clamp between -1 and 1
    return Math.max(-1, Math.min(1, score));
  };

  const calculateInteractionScore = (upvoteRatio: number): number => {
    // Convert upvote ratio to a -1 to 1 scale
    return ((upvoteRatio - 0.5) * 2);
  };

  const calculateRecencyScore = (created_utc: number): number => {
    const now = Date.now() / 1000; // Convert to seconds
    const age = now - created_utc;
    const dayInSeconds = 86400;
    
    // Posts newer than 1 day get higher scores
    if (age < dayInSeconds) {
      return 0.5;
    } else if (age < dayInSeconds * 7) {
      return 0.3;
    } else if (age < dayInSeconds * 30) {
      return 0.1;
    }
    return 0;
  };

  const calculateSentiment = (
    factors: SentimentFactors,
    medianScore: number,
    avgComments: number
  ): 'positive' | 'negative' | 'neutral' => {
    const sentimentScore = calculateSentimentScore(factors, medianScore, avgComments);
    
    // Adjusted thresholds for more balanced distribution
    if (sentimentScore >= 0.3) return 'positive';
    if (sentimentScore <= -0.3) return 'negative';
    return 'neutral';
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
                {renderSentimentChart()}
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
                            post.sentiment === 'positive' ? 'bg-green-100 text-green-800' :
                            post.sentiment === 'negative' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {post.sentiment.charAt(0).toUpperCase() + post.sentiment.slice(1)}
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
                            post.sentiment === 'positive' ? 'bg-green-100 text-green-800' :
                            post.sentiment === 'negative' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {post.sentiment.charAt(0).toUpperCase() + post.sentiment.slice(1)}
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
