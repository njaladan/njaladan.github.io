# Minifies JSON files in the built site on production builds. The pretty-printed
# sources stay in git; visitors get the compact copies.
require 'json'

Jekyll::Hooks.register :site, :post_write do |site|
  next unless Jekyll.env == 'production'

  site.static_files.each do |file|
    next unless file.extname == '.json'
    path = file.destination(site.dest)
    next unless File.file?(path)
    File.write(path, JSON.generate(JSON.parse(File.read(path, encoding: 'utf-8'))) + "\n", encoding: 'utf-8')
  end
end
