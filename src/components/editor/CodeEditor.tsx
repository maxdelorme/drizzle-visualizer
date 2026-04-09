import { useEffect, useState } from 'react';
import { AppFile } from '@/pages/Editor';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/themes/prism-tomorrow.css';

interface CodeEditorProps {
  files: AppFile[];
  activeFile: string | null;
  onContentChange: (fileName: string, content: string) => void;
}

const CodeEditor: React.FC<CodeEditorProps> = ({
  files,
  activeFile,
  onContentChange,
}) => {
  const [content, setContent] = useState('');

  useEffect(() => {
    if (activeFile) {
      const file = files.find((f) => f.name === activeFile);
      if (file) {
        setContent(file.content);
      }
    }
  }, [activeFile, files]);

  const handleContentChange = (newContent: string) => {
    setContent(newContent);

    if (activeFile) {
      onContentChange(activeFile, newContent);
    }
  };

  const getLanguage = (fileName: string) => {
    if (fileName.endsWith('.ts')) return Prism.languages.typescript;
    if (fileName.endsWith('.tsx')) return Prism.languages.typescript;
    if (fileName.endsWith('.js')) return Prism.languages.javascript;
    if (fileName.endsWith('.jsx')) return Prism.languages.javascript;
    return Prism.languages.javascript;
  };

  if (!activeFile) {
    return (
      <div className="h-full flex items-center justify-center p-4 text-muted-foreground">
        <p>Select a file from the sidebar or create a new one</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="p-2 border-b border-gray-800 bg-[#1e1e1e] text-sm">
        {activeFile}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <Editor
          value={content}
          onValueChange={handleContentChange}
          highlight={(code) =>
            Prism.highlight(code, getLanguage(activeFile), 'javascript')
          }
          padding={16}
          textareaId="schema-code-editor"
          textareaClassName="outline-none"
          preClassName="!m-0"
          className="w-full min-h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono text-sm code-editor"
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace',
          }}
          spellCheck={false}
        />
      </div>
    </div>
  );
};

export default CodeEditor;
