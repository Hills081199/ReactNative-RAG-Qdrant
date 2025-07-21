import React, { useState, useEffect } from 'react';
import {
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  Text,
  ScrollView,
  StyleSheet,
  View,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  FlatList,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import config from '../../env.json';

// Lấy config từ .env file
const QDRANT_URL = config.QDRANT_URL;
const QDRANT_COLLECTION = config.QDRANT_COLLECTION;
const QDRANT_API_KEY = config.QDRANT_API_KEY;
const OPENAI_API_KEY = config.OPENAI_API_KEY;
console.log(QDRANT_URL, QDRANT_COLLECTION, QDRANT_API_KEY, OPENAI_API_KEY)

const ITEMS_PER_PAGE = 5; // Số item hiển thị mỗi trang
const MAX_HISTORY_ITEMS = 50; // Tăng giới hạn lưu trữ

export default function App() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<{ question: string; answer: string; timestamp: string }[]>([]);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  
  // States cho phân trang và hiển thị lịch sử
  const [showHistory, setShowHistory] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [searchKeyword, setSearchKeyword] = useState('');

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const savedHistory = await AsyncStorage.getItem('questionHistory');
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
    } catch (err) {
      console.error('Error loading history:', err);
    }
  };

  const saveHistory = async (newEntry: { question: string; answer: string; timestamp: string }) => {
    try {
      const updatedHistory = [...history, newEntry].slice(-MAX_HISTORY_ITEMS); // Tăng giới hạn lưu trữ
      setHistory(updatedHistory);
      await AsyncStorage.setItem('questionHistory', JSON.stringify(updatedHistory));
    } catch (err) {
      console.error('Error saving history:', err);
    }
  };

  // Lọc lịch sử theo từ khóa tìm kiếm
  const filteredHistory = history.filter(item => 
    searchKeyword === '' || 
    item.question.toLowerCase().includes(searchKeyword.toLowerCase()) ||
    item.answer.toLowerCase().includes(searchKeyword.toLowerCase())
  ).reverse(); // Hiển thị mới nhất trước

  // Tính toán phân trang
  const totalPages = Math.ceil(filteredHistory.length / ITEMS_PER_PAGE);
  const startIndex = (historyPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedHistory = filteredHistory.slice(startIndex, endIndex);

  const askQuestion = async () => {
    if (!question.trim()) {
      Alert.alert('Lỗi', 'Vui lòng nhập câu hỏi');
      return;
    }

    // Kiểm tra API keys
    if (!QDRANT_URL || !QDRANT_COLLECTION || !QDRANT_API_KEY || !OPENAI_API_KEY) {
      Alert.alert('Lỗi', 'Thiếu thông tin cấu hình API. Vui lòng kiểm tra file .env');
      return;
    }

    try {
      setLoading(true);
      setAnswer('');

      // 1. Embedding câu hỏi với OpenAI
      const embedRes = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          input: question,
          model: 'text-embedding-3-small'
        },
        {
          headers: { 
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const embedding = embedRes.data.data[0].embedding;

      // 2. Query Qdrant với API key
      const searchRes = await axios.post(
        `${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points/search`,
        {
          vector: embedding,
          limit: 5,
          with_payload: true,
          with_vector: false
        },
        {
          headers: {
            'Api-Key': QDRANT_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      // 3. Tạo context từ kết quả tìm kiếm
      const contexts = searchRes.data.result
        .map((item: { payload: { text: string } }) => item.payload.text)
        .filter((text: string) => text)
        .join('\n\n');

      if (!contexts) {
        setAnswer('Không tìm thấy thông tin liên quan đến câu hỏi của bạn.');
        saveHistory({ question, answer: 'Không tìm thấy thông tin liên quan.', timestamp: new Date().toISOString() });
        return;
      }

      const prompt = `Bạn là một trợ lý nghiên cứu chuyên về quy hoạch đô thị và phát triển bền vững, hỗ trợ người dùng trong việc nghiên cứu tài liệu. Dựa trên thông tin tham khảo dưới đây, hãy trả lời câu hỏi một cách chi tiết, rõ ràng và có cấu trúc, phù hợp với mục đích nghiên cứu học thuật. Câu trả lời cần bao gồm:
1. Một đoạn giới thiệu ngắn giải thích bối cảnh của câu hỏi.
2. Phân tích chi tiết dựa trên thông tin tham khảo, sử dụng các ví dụ cụ thể nếu có.
3. Kết luận ngắn gọn và gợi ý các tài liệu hoặc hướng nghiên cứu bổ sung nếu phù hợp.

Thông tin tham khảo:
${contexts}

Câu hỏi: ${question}

Hãy trả lời bằng tiếng Việt, sử dụng ngôn ngữ học thuật, dễ hiểu và chính xác.`;

      // 4. Gọi Chat Completion với GPT-3.5-turbo
      const chatRes = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [
            { 
              role: 'system', 
              content: 'Bạn là chuyên gia nghiên cứu về quy hoạch đô thị và phát triển bền vững. Trả lời các câu hỏi bằng tiếng Việt với phong cách học thuật, chi tiết, và dễ hiểu, hỗ trợ người dùng trong việc nghiên cứu tài liệu.' 
            },
            { role: 'user', content: prompt }
          ],
          max_tokens: 1500,
          temperature: 0.6
        },
        {
          headers: { 
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const response = chatRes.data.choices[0].message.content;
      setAnswer(response);
      saveHistory({ question, answer: response, timestamp: new Date().toISOString() });

    } catch (err) {
      console.error('Error details:', err instanceof Error ? {
        message: err.message,
        ...(axios.isAxiosError(err) ? {
          status: err.response?.status,
          data: err.response?.data
        } : {})
      } : 'An unknown error occurred');
      
      let errorMessage = 'Có lỗi xảy ra khi truy vấn.';
      
      if (axios.isAxiosError(err)) {
        if (err.code === 'ERR_NETWORK') {
          errorMessage = 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng.';
        } else if (err.response?.status === 401) {
          errorMessage = 'API key không hợp lệ. Vui lòng kiểm tra lại.';
        } else if (err.response?.status === 404) {
          errorMessage = 'Không tìm thấy collection trong Qdrant.';
        } else if (err.response?.status === 429) {
          errorMessage = 'Đã vượt quá giới hạn API. Vui lòng thử lại sau.';
        } else if (err.response?.status === 400) {
          errorMessage = 'Yêu cầu không hợp lệ. Vui lòng kiểm tra câu hỏi hoặc cấu hình.';
        } else {
          errorMessage = `Lỗi từ máy chủ: ${err.response?.data?.error?.message || 'Không xác định'}`;
        }
      } else if (err instanceof Error) {
        errorMessage = `Lỗi: ${err.message}`;
      }
      
      setAnswer(errorMessage);
      saveHistory({ question, answer: errorMessage, timestamp: new Date().toISOString() });
      Alert.alert('Lỗi', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    Alert.alert(
      'Xác nhận xóa',
      'Bạn có chắc chắn muốn xóa toàn bộ lịch sử câu hỏi?',
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.removeItem('questionHistory');
              setHistory([]);
              setExpandedItems(new Set());
              setHistoryPage(1);
              setSearchKeyword('');
              Alert.alert('Thành công', 'Lịch sử câu hỏi đã được xóa.');
            } catch (err) {
              console.error('Error clearing history:', err);
              Alert.alert('Lỗi', 'Không thể xóa lịch sử câu hỏi.');
            }
          }
        }
      ]
    );
  };

  const toggleHistoryVisibility = () => {
    setShowHistory(!showHistory);
    if (!showHistory) {
      setHistoryPage(1); // Reset về trang đầu khi mở lịch sử
    }
  };

  const goToPage = (page: number) => {
    setHistoryPage(page);
    setExpandedItems(new Set()); // Thu gọn tất cả items khi chuyển trang
  };

  const renderHistoryItem = ({ item, index }: { item: { question: string; answer: string; timestamp: string }, index: number }) => {
    const actualIndex = startIndex + index; // Index thực trong mảng đầy đủ
    const isExpanded = expandedItems.has(actualIndex);
    const shouldTruncate = item.answer.length > 150;
    
    const toggleExpanded = () => {
      const newExpanded = new Set(expandedItems);
      if (isExpanded) {
        newExpanded.delete(actualIndex);
      } else {
        newExpanded.add(actualIndex);
      }
      setExpandedItems(newExpanded);
    };
    
    return (
      <View style={styles.historyItem}>
        <View style={styles.historyItemHeader}>
          <Text style={styles.historyQuestion} numberOfLines={2}>
            Q: {item.question}
          </Text>
          <Text style={styles.historyTimestamp}>
            {new Date(item.timestamp).toLocaleDateString('vi-VN', {
              day: '2-digit',
              month: '2-digit',
              year: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </Text>
        </View>
        <Text style={styles.historyAnswerLabel}>Trả lời:</Text>
        <Text style={styles.historyAnswer}>
          {isExpanded || !shouldTruncate 
            ? item.answer 
            : `${item.answer.substring(0, 150)}...`
          }
        </Text>
        {shouldTruncate && (
          <TouchableOpacity 
            onPress={toggleExpanded}
            style={styles.expandButton}
          >
            <Text style={styles.expandButtonText}>
              {isExpanded ? '↑ Thu gọn' : '↓ Xem thêm'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderPaginationControls = () => {
    if (totalPages <= 1) return null;

    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      pages.push(
        <TouchableOpacity
          key={i}
          style={[
            styles.pageButton,
            historyPage === i && styles.activePageButton
          ]}
          onPress={() => goToPage(i)}
        >
          <Text style={[
            styles.pageButtonText,
            historyPage === i && styles.activePageButtonText
          ]}>
            {i}
          </Text>
        </TouchableOpacity>
      );
    }

    return (
      <View style={styles.paginationContainer}>
        <TouchableOpacity
          style={[styles.navButton, historyPage === 1 && styles.navButtonDisabled]}
          onPress={() => goToPage(Math.max(1, historyPage - 1))}
          disabled={historyPage === 1}
        >
          <Text style={styles.navButtonText}>← Trước</Text>
        </TouchableOpacity>
        
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          style={styles.pagesContainer}
        >
          {pages}
        </ScrollView>
        
        <TouchableOpacity
          style={[styles.navButton, historyPage === totalPages && styles.navButtonDisabled]}
          onPress={() => goToPage(Math.min(totalPages, historyPage + 1))}
          disabled={historyPage === totalPages}
        >
          <Text style={styles.navButtonText}>Sau →</Text>
        </TouchableOpacity>
      </View>
    );
  };
  
  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Trợ lý Nghiên cứu Quy hoạch</Text>
          <Text style={styles.headerSubtitle}>Hỗ trợ nghiên cứu tài liệu quy hoạch đô thị</Text>
        </View>

        {/* Input Section */}
        <View style={styles.inputSection}>
          <TextInput
            style={styles.input}
            placeholder="Nhập câu hỏi về quy hoạch đô thị hoặc phát triển bền vững..."
            value={question}
            onChangeText={setQuestion}
            multiline
            maxLength={500}
            editable={!loading}
          />
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.askButton, loading && styles.buttonDisabled]}
              onPress={askQuestion}
              disabled={loading}
            >
              {loading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.buttonText}>Đang xử lý...</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>Gửi câu hỏi</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.historyToggleButton, loading && styles.buttonDisabled]}
              onPress={toggleHistoryVisibility}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {showHistory ? 'Ẩn lịch sử' : `Lịch sử (${history.length})`}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.clearButton, loading && styles.buttonDisabled]}
              onPress={clearHistory}
              disabled={loading}
            >
              <Text style={styles.buttonText}>Xóa lịch sử</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Answer Section */}
        <ScrollView style={styles.answerSection} showsVerticalScrollIndicator={false}>
          {answer ? (
            <View style={styles.answerCard}>
              <Text style={styles.answerLabel}>Trả lời:</Text>
              <Text style={styles.answerText}>{answer}</Text>
            </View>
          ) : null}

          {/* History Section */}
          {showHistory && (
            <View style={styles.historySection}>
              <View style={styles.historyHeader}>
                <Text style={styles.historyLabel}>
                  Lịch sử câu hỏi ({filteredHistory.length})
                </Text>
                
                {/* Search Box */}
                <TextInput
                  style={styles.searchInput}
                  placeholder="Tìm kiếm trong lịch sử..."
                  value={searchKeyword}
                  onChangeText={(text) => {
                    setSearchKeyword(text);
                    setHistoryPage(1); // Reset về trang đầu khi tìm kiếm
                  }}
                />
              </View>

              {filteredHistory.length > 0 ? (
                <>
                  <FlatList
                    data={paginatedHistory}
                    renderItem={({ item, index }) => renderHistoryItem({ item, index })}
                    keyExtractor={(item, index) => `${startIndex + index}`}
                    showsVerticalScrollIndicator={false}
                    scrollEnabled={false} // Disable FlatList scroll để dùng ScrollView chính
                  />
                  
                  {renderPaginationControls()}
                  
                  <Text style={styles.paginationInfo}>
                    Hiển thị {startIndex + 1}-{Math.min(endIndex, filteredHistory.length)} 
                    / {filteredHistory.length} mục
                  </Text>
                </>
              ) : (
                <View style={styles.emptyHistoryContainer}>
                  <Text style={styles.emptyHistoryText}>
                    {searchKeyword ? 'Không tìm thấy kết quả phù hợp' : 'Chưa có lịch sử câu hỏi'}
                  </Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    backgroundColor: '#4a90e2',
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#e8f4f8',
    opacity: 0.9,
  },
  inputSection: {
    padding: 20,
    backgroundColor: '#fff',
    marginTop: 10,
    marginHorizontal: 15,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e1e8ed',
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
    backgroundColor: '#fafbfc',
  },
  buttonContainer: {
    marginTop: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  askButton: {
    backgroundColor: '#4a90e2',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: '#4a90e2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
    flex: 1,
    minWidth: 120,
  },
  historyToggleButton: {
    backgroundColor: '#27ae60',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: '#27ae60',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
    flex: 1,
    minWidth: 120,
  },
  clearButton: {
    backgroundColor: '#e74c3c',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: '#e74c3c',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
    flex: 1,
    minWidth: 120,
  },
  buttonDisabled: {
    backgroundColor: '#a0a0a0',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  answerSection: {
    flex: 1,
    paddingHorizontal: 15,
  },
  answerCard: {
    backgroundColor: '#fff',
    marginTop: 15,
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  answerLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 10,
  },
  answerText: {
    fontSize: 15,
    lineHeight: 24,
    color: '#34495e',
  },
  historySection: {
    marginTop: 20,
    paddingBottom: 20,
  },
  historyHeader: {
    marginBottom: 15,
  },
  historyLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 10,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#e1e8ed',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#fafbfc',
  },
  historyItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  historyItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  historyQuestion: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2c3e50',
    flex: 1,
    marginRight: 10,
  },
  historyTimestamp: {
    fontSize: 11,
    color: '#7f8c8d',
    textAlign: 'right',
  },
  historyAnswerLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#7f8c8d',
    marginBottom: 5,
  },
  historyAnswer: {
    fontSize: 13,
    color: '#34495e',
    lineHeight: 18,
  },
  expandButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#f8f9fa',
    borderRadius: 4,
  },
  expandButtonText: {
    color: '#4a90e2',
    fontSize: 12,
    fontWeight: '500',
  },
  paginationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
    paddingVertical: 10,
  },
  navButton: {
    backgroundColor: '#4a90e2',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    minWidth: 70,
    alignItems: 'center',
  },
  navButtonDisabled: {
    backgroundColor: '#bdc3c7',
  },
  navButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  pagesContainer: {
    flex: 1,
    marginHorizontal: 15,
  },
  pageButton: {
    backgroundColor: '#ecf0f1',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginHorizontal: 2,
    minWidth: 35,
    alignItems: 'center',
  },
  activePageButton: {
    backgroundColor: '#4a90e2',
  },
  pageButtonText: {
    color: '#34495e',
    fontSize: 12,
    fontWeight: '500',
  },
  activePageButtonText: {
    color: '#fff',
  },
  paginationInfo: {
    textAlign: 'center',
    fontSize: 12,
    color: '#7f8c8d',
    marginTop: 10,
  },
  emptyHistoryContainer: {
    padding: 30,
    alignItems: 'center',
  },
  emptyHistoryText: {
    fontSize: 14,
    color: '#7f8c8d',
    fontStyle: 'italic',
  },
});