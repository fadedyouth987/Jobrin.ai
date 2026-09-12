-- Keep the private Jobrin.ai asset bucket constrained to expected upload types.
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'application/pdf', 'text/plain', 'text/csv',
      'audio/mpeg', 'audio/wav', 'video/mp4'
    ]
where id = 'jobrin-assets';
