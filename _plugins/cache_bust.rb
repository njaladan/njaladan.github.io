# Stamps every local asset link in rendered HTML with the build time, so each
# deploy gets fresh URLs past browser and CDN caches. Scripts that build asset
# URLs at runtime read the same stamp from <meta name="asset-version">.
# Pages with ES modules also get an import map, so modules a script imports
# carry the stamp too.
module CacheBust
  EXTENSIONS = %w[css js mjs json png jpg jpeg webp avif gif svg ico woff woff2 gpx pdf mp4 webm].join('|')
  ATTRIBUTE = /(\s(?:src|href|poster)=)(["'])(?!(?:[a-z][a-z0-9+.-]*:|\/\/|#))([^"'?#]+\.(?:#{EXTENSIONS}))(\?[^"'#]*)?/i

  def self.stamp(site)
    @stamps ||= {}
    @stamps[site.time] ||= site.time.to_i.to_s
  end

  def self.apply(item)
    return unless item.output_ext == '.html' && item.output
    version = stamp(item.site)
    output = item.output.gsub(ATTRIBUTE) do
      prefix, quote, path, query = Regexp.last_match.captures
      params = (query || '').delete_prefix('?').split('&').reject { |param| param.empty? || param.start_with?('v=') }
      "#{prefix}#{quote}#{path}?#{(params << "v=#{version}").join('&')}"
    end
    head = %(\n  <meta name="asset-version" content="#{version}">)
    head += import_map(item.site, version) if output.include?('type="module"')
    item.output = output.sub(/<head(\s[^>]*)?>/i) { "#{Regexp.last_match(0)}#{head}" }
  end

  def self.import_map(site, version)
    base = site.config['baseurl'].to_s
    imports = site.static_files
      .map { |file| "#{base}#{file.relative_path}" }
      .select { |path| path.start_with?("#{base}/assets/js/") && path.end_with?('.js') }
      .sort
      .to_h { |path| [path, "#{path}?v=#{version}"] }
    %(\n  <script type="importmap">#{JSON.generate({ imports: imports })}</script>)
  end
end

Jekyll::Hooks.register [:pages, :documents], :post_render do |item|
  CacheBust.apply(item)
end
