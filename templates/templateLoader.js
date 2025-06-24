// templates/templateLoader.js - Fixed variable replacement
const fs = require('fs');
const path = require('path');

class TemplateLoader {
  constructor() {
    this.templates = new Map();
    this.templatesPath = path.join(__dirname);
    this.loadAllTemplates();
  }

  /**
   * Load all template files from the templates directory
   */
  loadAllTemplates() {
    try {
      const files = fs.readdirSync(this.templatesPath);
      
      files.forEach(file => {
        if (file.endsWith('.json') || file.endsWith('.txt')) {
          const templateName = path.basename(file, path.extname(file));
          this.loadTemplate(templateName, file);
        }
      });

      console.log(`✅ Loaded ${this.templates.size} message templates`);
    } catch (error) {
      console.error('❌ Error loading templates:', error);
    }
  }

  /**
   * Load a specific template file
   */
  loadTemplate(name, filename) {
    try {
      const filePath = path.join(this.templatesPath, filename);
      const content = fs.readFileSync(filePath, 'utf8');
      
      if (filename.endsWith('.json')) {
        this.templates.set(name, JSON.parse(content));
      } else {
        this.templates.set(name, content.trim());
      }
    } catch (error) {
      console.error(`❌ Error loading template ${name}:`, error);
    }
  }

  /**
   * Get a template by name with variable replacement
   */
  get(templateName, variables = {}) {
    const template = this.templates.get(templateName);
    
    if (!template) {
      console.warn(`⚠️ Template '${templateName}' not found`);
      return `Template '${templateName}' not found`;
    }

    // If it's a string template, replace variables
    if (typeof template === 'string') {
      return this.replaceVariables(template, variables);
    }

    // If it's a JSON template, return object with variable replacement
    if (typeof template === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(template)) {
        if (typeof value === 'string') {
          result[key] = this.replaceVariables(value, variables);
        } else {
          result[key] = value;
        }
      }
      return result;
    }

    return template;
  }

  /**
   * Replace variables in template strings
   */
  replaceVariables(template, variables) {
    let result = template;
    
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(placeholder, value || '');
    }
    
    return result;
  }

  /**
   * Reload all templates (useful for development)
   */
  reload() {
    this.templates.clear();
    this.loadAllTemplates();
  }

  /**
   * List all available templates
   */
  list() {
    return Array.from(this.templates.keys());
  }
}

// Export singleton instance
module.exports = new TemplateLoader();